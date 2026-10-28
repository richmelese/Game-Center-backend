import { Injectable } from '@nestjs/common';
import { Order, PlanType, PlayMode, Prisma } from '@prisma/client';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { addHours, startOfAddisDay } from '../common/time';

export interface GameAccess {
  hasAccess: boolean;
  subscription: { type: PlanType; expiresAt: Date } | null;
  playsRemaining: number;
  demoPlaysLeft: number;
  demoSeconds: number;
}

/** Journey step 5: a successful transaction results in the applicable game access/entitlement. */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Called inside the payment transaction once an order is confirmed as paid. */
  async grantForOrder(tx: Prisma.TransactionClient, order: Order) {
    const plan = await tx.plan.findUniqueOrThrow({
      where: { id: order.planId },
    });
    const now = new Date();
    if (plan.type === PlanType.PAY_PER_USE) {
      return tx.entitlement.create({
        data: {
          userId: order.userId,
          gameId: order.gameId,
          orderId: order.id,
          type: plan.type,
          startsAt: now,
          playsRemaining: plan.plays ?? 1,
        },
      });
    }
    // Subscriptions stack: a renewal bought before expiry starts when the current one ends.
    const current = await tx.entitlement.findFirst({
      where: {
        userId: order.userId,
        gameId: order.gameId,
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: 'desc' },
    });
    const startsAt =
      current?.expiresAt && current.expiresAt > now ? current.expiresAt : now;
    return tx.entitlement.create({
      data: {
        userId: order.userId,
        gameId: order.gameId,
        orderId: order.id,
        type: plan.type,
        startsAt,
        expiresAt: addHours(startsAt, plan.durationHours ?? 24),
      },
    });
  }

  activeSubscription(userId: string, gameId: string, now = new Date()) {
    return this.prisma.entitlement.findFirst({
      where: { userId, gameId, startsAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
    });
  }

  async access(userId: string, gameId: string): Promise<GameAccess> {
    const now = new Date();
    const [subs, ppu, demoToday] = await Promise.all([
      this.prisma.entitlement.findMany({
        where: { userId, gameId, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'desc' },
      }),
      this.prisma.entitlement.aggregate({
        where: {
          userId,
          gameId,
          type: PlanType.PAY_PER_USE,
          playsRemaining: { gt: 0 },
        },
        _sum: { playsRemaining: true },
      }),
      this.prisma.playSession.count({
        where: {
          userId,
          gameId,
          mode: PlayMode.DEMO,
          startedAt: { gte: startOfAddisDay(now) },
        },
      }),
    ]);
    const active = subs.find((s) => s.startsAt <= now);
    const playsRemaining = ppu._sum.playsRemaining ?? 0;
    return {
      hasAccess: Boolean(active) || playsRemaining > 0,
      // latest expiry, so stacked renewals show the full paid-up period
      subscription: active
        ? { type: subs[0].type, expiresAt: subs[0].expiresAt! }
        : null,
      playsRemaining,
      demoPlaysLeft: Math.max(0, this.config.demo.playsPerDay - demoToday),
      demoSeconds: this.config.demo.seconds,
    };
  }

  async listMine(userId: string) {
    const now = new Date();
    const rows = await this.prisma.entitlement.findMany({
      where: {
        userId,
        OR: [
          { expiresAt: { gt: now } },
          { type: PlanType.PAY_PER_USE, playsRemaining: { gt: 0 } },
        ],
      },
      include: {
        game: {
          select: {
            slug: true,
            title: true,
            category: true,
            themeColor: true,
            imageUrl: true,
          },
        },
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((e) => ({
      id: e.id,
      type: e.type,
      game: { ...e.game, imageUrl: this.config.gameAssetUrl(e.game.imageUrl) },
      startsAt: e.startsAt,
      expiresAt: e.expiresAt,
      playsRemaining: e.playsRemaining,
      isActiveNow: e.type === PlanType.PAY_PER_USE || e.startsAt <= now,
    }));
  }
}
