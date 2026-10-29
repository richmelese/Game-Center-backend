import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CoinMode, CoinTxType, PlayMode, Prisma } from '@prisma/client';
import { coinsForScore } from '../common/coins';
import { startOfAddisDay } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { CoinSettingsService } from '../settings/coin-settings.service';
import { verifyResultSignature } from './result-signature';

/** Results for a session are accepted while it is open and briefly after it ends. */
const OPEN_SESSION_IDLE_SECONDS = 600;
const ENDED_SESSION_GRACE_SECONDS = 300;

export interface ReportedResult {
  resultId: string;
  sessionId: string;
  score: number;
  level?: number;
  won?: boolean;
}

/**
 * Journey step 7 (SCORE mode): the game supplier's server reports each result
 * server-to-server. Only signed, recent, non-duplicate results for an open, purchased
 * session of the same game earn coins, within the usual per-session and daily caps.
 */
@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coinSettings: CoinSettingsService,
  ) {}

  async report(
    slug: string,
    headers: { timestamp?: string; signature?: string },
    rawBody: Buffer | undefined,
    result: ReportedResult,
  ) {
    const game = await this.prisma.game.findUnique({ where: { slug } });
    if (!game?.resultSecret) {
      throw new NotFoundException(
        'Result reporting is not enabled for this game',
      );
    }

    // 1. authenticity: signed by the supplier with this game's secret, and recent
    const check = verifyResultSignature(
      game.resultSecret,
      headers.timestamp,
      headers.signature,
      rawBody,
    );
    if (!check.ok) {
      this.logger.warn(
        `Rejected ${slug} result ${result.resultId}: ${check.reason}`,
      );
      throw new UnauthorizedException(`Invalid signature (${check.reason})`);
    }

    // 2. idempotency: the same result is only ever counted once
    const existing = await this.prisma.gameResult.findUnique({
      where: {
        gameId_resultId: { gameId: game.id, resultId: result.resultId },
      },
    });
    if (existing) return this.view(existing, true);

    // 3. the session must belong to this game and still be live
    const session = await this.prisma.playSession.findUnique({
      where: { id: result.sessionId },
    });
    if (!session || session.gameId !== game.id) {
      throw new NotFoundException('Unknown play session for this game');
    }
    const now = Date.now();
    const live = session.endedAt
      ? now - session.endedAt.getTime() <= ENDED_SESSION_GRACE_SECONDS * 1000
      : now - session.lastHeartbeatAt.getTime() <=
        OPEN_SESSION_IDLE_SECONDS * 1000;
    if (!live) throw new ForbiddenException('Play session has expired');

    // demo sessions and time-based sessions are recorded but never paid by score
    const payable =
      session.mode === PlayMode.FULL && session.coinMode === CoinMode.SCORE;
    const rules = await this.coinSettings.rules();

    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        // serialize results of the same session so the caps hold under concurrency
        await tx.$queryRaw`SELECT id FROM "PlaySession" WHERE id = ${session.id} FOR UPDATE`;
        const current = await tx.playSession.findUniqueOrThrow({
          where: { id: session.id },
        });
        let coins = 0;
        if (payable) {
          const today = await tx.coinTransaction.aggregate({
            where: {
              userId: session.userId,
              type: CoinTxType.EARN,
              createdAt: { gte: startOfAddisDay() },
            },
            _sum: { amount: true },
          });
          coins = coinsForScore(
            result.score,
            game.pointsPerCoin,
            current.coinsEarned,
            today._sum.amount ?? 0,
            rules,
          );
        }

        const row = await tx.gameResult.create({
          data: {
            gameId: game.id,
            sessionId: session.id,
            userId: session.userId,
            resultId: result.resultId,
            score: result.score,
            level: result.level,
            won: result.won,
            coinsAwarded: coins,
          },
        });
        await tx.playSession.update({
          where: { id: session.id },
          data: {
            score: (current.score ?? 0) + result.score,
            ...(coins > 0 ? { coinsEarned: { increment: coins } } : {}),
          },
        });
        if (coins > 0) {
          const user = await tx.user.update({
            where: { id: session.userId },
            data: { coinBalance: { increment: coins } },
          });
          await tx.coinTransaction.create({
            data: {
              userId: session.userId,
              type: CoinTxType.EARN,
              amount: coins,
              balanceAfter: user.coinBalance,
              sessionId: session.id,
              note: `Coins earned from score in ${game.title}`,
            },
          });
        }
        return row;
      });
      return this.view(saved, false);
    } catch (err) {
      // two identical reports racing: the unique index lets only one through
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const row = await this.prisma.gameResult.findUnique({
          where: {
            gameId_resultId: { gameId: game.id, resultId: result.resultId },
          },
        });
        if (row) return this.view(row, true);
        throw new ConflictException('Duplicate result');
      }
      throw err;
    }
  }

  private view(
    r: {
      resultId: string;
      sessionId: string;
      score: number;
      coinsAwarded: number;
    },
    duplicate: boolean,
  ) {
    return {
      accepted: true,
      duplicate,
      resultId: r.resultId,
      sessionId: r.sessionId,
      score: r.score,
      coinsAwarded: r.coinsAwarded,
    };
  }
}
