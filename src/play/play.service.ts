import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CoinMode,
  CoinTxType,
  PlanType,
  PlayMode,
  PlaySession,
} from '@prisma/client';
import { AppConfig } from '../config/app-config.service';
import { coinsForSession } from '../common/coins';
import { startOfAddisDay } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { CoinSettingsService } from '../settings/coin-settings.service';
import { EntitlementsService } from '../entitlements/entitlements.service';

export const HEARTBEAT_SECONDS = 15;
/** Max seconds credited per heartbeat; longer gaps (tab hidden, app closed) are not counted. */
const MAX_CREDIT_PER_BEAT = HEARTBEAT_SECONDS * 2;

/**
 * Journey step 6: customer launches and uses the game.
 * Journey step 7: customer plays purchased games and accumulates coins.
 *
 * Coins are only earned in purchased (FULL) sessions, in one of two ways per game:
 *  - TIME:  server-measured active play time (heartbeats) — never client-reported scores
 *  - SCORE: results signed and reported server-to-server by the game supplier (ResultsService)
 * Demo sessions are time-limited and earn nothing.
 */
@Injectable()
export class PlayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly entitlements: EntitlementsService,
    private readonly coinSettings: CoinSettingsService,
  ) {}

  async start(userId: string, slug: string, mode: PlayMode) {
    const game = await this.prisma.game.findUnique({ where: { slug } });
    if (!game || !game.isActive) throw new NotFoundException('Game not found');

    // one game at a time: close any session still open so play time is never double counted
    const open = await this.prisma.playSession.findMany({
      where: { userId, endedAt: null },
    });
    for (const s of open) await this.finish(s, undefined);

    let entitlementId: string | null = null;
    if (mode === PlayMode.DEMO) {
      const access = await this.entitlements.access(userId, game.id);
      if (access.demoPlaysLeft <= 0) {
        throw new ForbiddenException(
          'You have used today’s free demo plays for this game. Subscribe to keep playing.',
        );
      }
    } else {
      const sub = await this.entitlements.activeSubscription(userId, game.id);
      if (sub) {
        entitlementId = sub.id;
      } else {
        entitlementId = await this.consumePayPerUse(userId, game.id);
        if (!entitlementId) {
          throw new HttpException(
            'Purchase a plan to play this game',
            HttpStatus.PAYMENT_REQUIRED,
          );
        }
      }
    }

    const session = await this.prisma.playSession.create({
      data: {
        userId,
        gameId: game.id,
        mode,
        entitlementId,
        coinMode: game.coinMode,
      },
    });

    // SCORE games receive the session id so the supplier's server can report results for it
    let gameUrl = this.config.gameAssetUrl(game.gameUrl);
    if (game.coinMode === CoinMode.SCORE) {
      const url = new URL(gameUrl);
      url.searchParams.set('tg_session', session.id);
      gameUrl = url.toString();
    }
    const rules = await this.coinSettings.rules();
    return {
      sessionId: session.id,
      mode,
      game: { slug: game.slug, title: game.title, gameUrl },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      demoSeconds: mode === PlayMode.DEMO ? this.config.demo.seconds : null,
      coinRules: {
        coinMode: game.coinMode,
        coinsPerInterval: rules.coinsPerInterval,
        intervalMinutes: rules.intervalMinutes,
        pointsPerCoin: game.pointsPerCoin,
        maxPerSession: rules.maxPerSession,
      },
    };
  }

  /** Takes one play from the oldest pay-per-use entitlement that still has plays left. */
  private async consumePayPerUse(
    userId: string,
    gameId: string,
  ): Promise<string | null> {
    const candidates = await this.prisma.entitlement.findMany({
      where: {
        userId,
        gameId,
        type: PlanType.PAY_PER_USE,
        playsRemaining: { gt: 0 },
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const e of candidates) {
      const r = await this.prisma.entitlement.updateMany({
        where: { id: e.id, playsRemaining: { gt: 0 } },
        data: { playsRemaining: { decrement: 1 } },
      });
      if (r.count === 1) return e.id;
    }
    return null;
  }

  private async owned(userId: string, sessionId: string) {
    const s = await this.prisma.playSession.findUnique({
      where: { id: sessionId },
    });
    if (!s || s.userId !== userId)
      throw new NotFoundException('Session not found');
    return s;
  }

  private creditFor(s: PlaySession, now: Date) {
    const gap = Math.floor(
      (now.getTime() - s.lastHeartbeatAt.getTime()) / 1000,
    );
    return gap > 0 && gap <= MAX_CREDIT_PER_BEAT ? gap : 0;
  }

  async heartbeat(userId: string, sessionId: string) {
    const s = await this.owned(userId, sessionId);
    if (s.endedAt)
      return { ended: true, reason: 'ENDED', activeSeconds: s.activeSeconds };
    const now = new Date();
    const activeSeconds = s.activeSeconds + this.creditFor(s, now);
    await this.prisma.playSession.updateMany({
      where: { id: s.id, endedAt: null },
      data: { activeSeconds, lastHeartbeatAt: now },
    });

    if (s.mode === PlayMode.DEMO && activeSeconds >= this.config.demo.seconds) {
      const summary = await this.end(userId, sessionId);
      return { ...summary, ended: true, reason: 'DEMO_TIME_UP' };
    }
    if (s.mode === PlayMode.FULL && s.entitlementId) {
      const e = await this.prisma.entitlement.findUnique({
        where: { id: s.entitlementId },
      });
      if (e?.expiresAt && e.expiresAt <= now) {
        const summary = await this.end(userId, sessionId);
        return { ...summary, ended: true, reason: 'SUBSCRIPTION_EXPIRED' };
      }
    }
    let coinsSoFar = 0;
    if (s.mode === PlayMode.FULL) {
      coinsSoFar =
        s.coinMode === CoinMode.SCORE
          ? s.coinsEarned // already credited as results arrive
          : await this.previewCoins(userId, activeSeconds);
    }
    return { ended: false, activeSeconds, coinsSoFar };
  }

  async end(userId: string, sessionId: string, score?: number) {
    const s = await this.owned(userId, sessionId);
    return this.finish(s, score);
  }

  private async earnedToday(userId: string) {
    const r = await this.prisma.coinTransaction.aggregate({
      where: {
        userId,
        type: CoinTxType.EARN,
        createdAt: { gte: startOfAddisDay() },
      },
      _sum: { amount: true },
    });
    return r._sum.amount ?? 0;
  }

  private async previewCoins(userId: string, activeSeconds: number) {
    return coinsForSession(
      activeSeconds,
      await this.earnedToday(userId),
      await this.coinSettings.rules(),
    );
  }

  private async finish(s: PlaySession, score?: number) {
    if (s.endedAt) return this.summary(s);
    const now = new Date();
    const activeSeconds = s.activeSeconds + this.creditFor(s, now);
    const rules = await this.coinSettings.rules(); // rules in force when the session ends

    const result = await this.prisma.$transaction(async (tx) => {
      // claim the end exactly once
      const claimed = await tx.playSession.updateMany({
        where: { id: s.id, endedAt: null },
        data: { endedAt: now, activeSeconds, lastHeartbeatAt: now, score },
      });
      if (claimed.count === 0) return null;
      // demo sessions earn nothing; SCORE sessions are paid per reported result instead
      if (s.mode !== PlayMode.FULL || s.coinMode === CoinMode.SCORE) {
        return { coins: 0 };
      }

      const today = await tx.coinTransaction.aggregate({
        where: {
          userId: s.userId,
          type: CoinTxType.EARN,
          createdAt: { gte: startOfAddisDay(now) },
        },
        _sum: { amount: true },
      });
      const coins = coinsForSession(
        activeSeconds,
        today._sum.amount ?? 0,
        rules,
      );
      if (coins > 0) {
        const user = await tx.user.update({
          where: { id: s.userId },
          data: { coinBalance: { increment: coins } },
        });
        await tx.coinTransaction.create({
          data: {
            userId: s.userId,
            type: CoinTxType.EARN,
            amount: coins,
            balanceAfter: user.coinBalance,
            sessionId: s.id,
            note: 'Coins earned from play',
          },
        });
        await tx.playSession.update({
          where: { id: s.id },
          data: { coinsEarned: coins },
        });
      }
      return { coins };
    });

    const fresh = await this.prisma.playSession.findUniqueOrThrow({
      where: { id: s.id },
    });
    return this.summary(fresh, result === null);
  }

  private async summary(s: PlaySession, alreadyEnded = true) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: s.userId },
    });
    return {
      sessionId: s.id,
      mode: s.mode,
      activeSeconds: s.activeSeconds,
      coinsEarned: s.coinsEarned,
      coinBalance: user.coinBalance,
      alreadyEnded,
    };
  }
}
