import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CoinMode,
  CoinTxType,
  Game,
  OrderStatus,
  Plan,
  PlayMode,
  Prisma,
  RedemptionStatus,
  TicketStatus,
} from '@prisma/client';
import { maskPhone } from '../common/phone';
import { newResultSecret } from '../results/result-signature';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

export interface Range {
  from: Date;
  to: Date;
}

/** Reporting & operations for LEMAT and Ethio Telecom (revenue reconciliation, payouts, support). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async summary({ from, to }: Range) {
    const paid = { status: OrderStatus.PAID, paidAt: { gte: from, lt: to } };
    const now = new Date();
    const [
      revenue,
      byPlan,
      byGame,
      users,
      activeSubs,
      plays,
      coinsIssued,
      redemptions,
      openTickets,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: paid,
        _count: true,
        _sum: {
          amountCents: true,
          vatCents: true,
          otherTaxCents: true,
          netCents: true,
          partnerShareCents: true,
          operatorShareCents: true,
        },
      }),
      this.prisma.order.groupBy({
        by: ['planType'],
        where: paid,
        _count: true,
        _sum: {
          amountCents: true,
          netCents: true,
          partnerShareCents: true,
          operatorShareCents: true,
        },
      }),
      this.prisma.order.groupBy({
        by: ['gameId'],
        where: paid,
        _count: true,
        _sum: {
          amountCents: true,
          netCents: true,
          partnerShareCents: true,
          operatorShareCents: true,
        },
        orderBy: { _sum: { amountCents: 'desc' } },
      }),
      this.prisma.user.count({ where: { role: 'USER' } }),
      this.prisma.entitlement.count({
        where: { startsAt: { lte: now }, expiresAt: { gt: now } },
      }),
      this.prisma.playSession.groupBy({
        by: ['mode'],
        where: { startedAt: { gte: from, lt: to } },
        _count: true,
      }),
      this.prisma.coinTransaction.aggregate({
        where: { type: CoinTxType.EARN, createdAt: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
      this.prisma.redemption.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lt: to } },
        _count: true,
        _sum: { amountCents: true, coins: true },
      }),
      this.prisma.supportTicket.count({
        where: { status: { not: TicketStatus.RESOLVED } },
      }),
    ]);

    const games = await this.prisma.game.findMany({
      select: { id: true, title: true, slug: true, imageUrl: true },
    });
    const gameById = new Map(games.map((g) => [g.id, g]));
    const s = revenue._sum;
    return {
      range: { from, to },
      revenue: {
        paidOrders: revenue._count,
        grossCents: s.amountCents ?? 0,
        vatCents: s.vatCents ?? 0,
        otherTaxCents: s.otherTaxCents ?? 0,
        netCents: s.netCents ?? 0,
        partnerShareCents: s.partnerShareCents ?? 0,
        operatorShareCents: s.operatorShareCents ?? 0,
      },
      byPlan: byPlan.map((p) => ({
        planType: p.planType,
        orders: p._count,
        grossCents: p._sum.amountCents ?? 0,
        netCents: p._sum.netCents ?? 0,
        partnerShareCents: p._sum.partnerShareCents ?? 0,
        operatorShareCents: p._sum.operatorShareCents ?? 0,
      })),
      byGame: byGame.map((g) => ({
        gameId: g.gameId,
        slug: gameById.get(g.gameId)?.slug ?? '',
        imageUrl: this.config.gameAssetUrl(
          gameById.get(g.gameId)?.imageUrl ?? null,
        ),
        title: gameById.get(g.gameId)?.title ?? g.gameId,
        orders: g._count,
        grossCents: g._sum.amountCents ?? 0,
        netCents: g._sum.netCents ?? 0,
        partnerShareCents: g._sum.partnerShareCents ?? 0,
        operatorShareCents: g._sum.operatorShareCents ?? 0,
      })),
      users,
      activeSubscriptions: activeSubs,
      plays: {
        full: plays.find((p) => p.mode === PlayMode.FULL)?._count ?? 0,
        demo: plays.find((p) => p.mode === PlayMode.DEMO)?._count ?? 0,
      },
      coinsIssued: coinsIssued._sum.amount ?? 0,
      redemptions: Object.values(RedemptionStatus).map((st) => {
        const r = redemptions.find((x) => x.status === st);
        return {
          status: st,
          count: r?._count ?? 0,
          coins: r?._sum.coins ?? 0,
          amountCents: r?._sum.amountCents ?? 0,
        };
      }),
      openTickets,
    };
  }

  /** Daily revenue in Addis Ababa time (UTC+3). */
  async daily({ from, to }: Range) {
    const rows = await this.prisma.$queryRaw<
      {
        day: Date;
        orders: bigint;
        gross: bigint;
        net: bigint;
        partner: bigint;
        operator: bigint;
      }[]
    >(Prisma.sql`
      SELECT date_trunc('day', "paidAt" + interval '3 hours') AS day,
             COUNT(*) AS orders,
             SUM("amountCents") AS gross,
             SUM("netCents") AS net,
             SUM("partnerShareCents") AS partner,
             SUM("operatorShareCents") AS operator
      FROM "Order"
      WHERE status = 'PAID' AND "paidAt" >= ${from} AND "paidAt" < ${to}
      GROUP BY 1 ORDER BY 1`);
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      orders: Number(r.orders),
      grossCents: Number(r.gross),
      netCents: Number(r.net),
      partnerShareCents: Number(r.partner),
      operatorShareCents: Number(r.operator),
    }));
  }

  /** Reconciliation export of paid orders; customer numbers are masked (data protection, section 6.2). */
  async revenueCsv({ from, to }: Range) {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.PAID, paidAt: { gte: from, lt: to } },
      include: {
        game: { select: { title: true } },
        user: { select: { phone: true } },
      },
      orderBy: { paidAt: 'asc' },
    });
    const money = (c: number) => (c / 100).toFixed(2);
    const esc = (raw: string) => {
      // stop spreadsheet formula injection (=, +, -, @, tab, CR at the start of a text cell)
      const v =
        /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw)
          ? `'${raw}`
          : raw;
      return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const header = [
      'merch_order_id',
      'telebirr_txn_id',
      'paid_at_utc',
      'customer',
      'game',
      'plan',
      'gross_etb',
      'vat_etb',
      'other_tax_etb',
      'net_etb',
      'lemat_share_etb',
      'ethio_telecom_share_etb',
    ];
    const lines = orders.map((o) =>
      [
        o.merchOrderId,
        o.providerTxnId ?? '',
        o.paidAt?.toISOString() ?? '',
        o.user.phone ? maskPhone(o.user.phone) : '',
        o.game.title,
        o.planType,
        money(o.amountCents),
        money(o.vatCents),
        money(o.otherTaxCents),
        money(o.netCents),
        money(o.partnerShareCents),
        money(o.operatorShareCents),
      ]
        .map((v) => esc(String(v)))
        .join(','),
    );
    return [header.join(','), ...lines].join('\n') + '\n';
  }

  async orders(status?: OrderStatus, page = 1) {
    const take = 25;
    const where = status ? { status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          game: { select: { title: true } },
          user: { select: { phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take,
      }),
    ]);
    return {
      total,
      page,
      pageSize: take,
      rows: rows.map((o) => ({
        merchOrderId: o.merchOrderId,
        status: o.status,
        planType: o.planType,
        game: o.game.title,
        customer: o.user.phone ? maskPhone(o.user.phone) : null,
        amountCents: o.amountCents,
        partnerShareCents: o.partnerShareCents,
        operatorShareCents: o.operatorShareCents,
        providerTxnId: o.providerTxnId,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
      })),
    };
  }

  /** The result secret itself is never returned; only whether one is set. */
  private adminGame({ resultSecret, ...g }: Game & { plans: Plan[] }) {
    return { ...g, hasResultSecret: Boolean(resultSecret) };
  }

  async games() {
    const games = await this.prisma.game.findMany({
      include: { plans: true },
      orderBy: { sortOrder: 'asc' },
    });
    return games.map((g) => this.adminGame(g));
  }

  async updateGame(id: string, data: Prisma.GameUpdateInput) {
    const game = await this.prisma.game.findUnique({ where: { id } });
    if (!game) throw new NotFoundException('Game not found');
    if (data.coinMode === CoinMode.SCORE && !game.resultSecret) {
      throw new BadRequestException(
        'Generate a result secret and share it with the game supplier before switching to score-based coins',
      );
    }
    const updated = await this.prisma.game.update({
      where: { id },
      data,
      include: { plans: true },
    });
    return this.adminGame(updated);
  }

  /**
   * Creates (or rotates) the HMAC secret the game supplier uses to sign results.
   * Shown once; rotating immediately invalidates the previous secret.
   */
  async rotateResultSecret(id: string) {
    const game = await this.prisma.game.findUnique({ where: { id } });
    if (!game) throw new NotFoundException('Game not found');
    const secret = newResultSecret();
    await this.prisma.game.update({
      where: { id },
      data: { resultSecret: secret },
    });
    return {
      gameId: id,
      slug: game.slug,
      resultSecret: secret,
      reportUrl: `/api/games/${game.slug}/results`,
    };
  }

  /** Latest results reported by game suppliers (SCORE mode monitoring). */
  async results(gameId?: string) {
    const rows = await this.prisma.gameResult.findMany({
      where: gameId ? { gameId } : {},
      include: { game: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      game: r.game.title,
      resultId: r.resultId,
      sessionId: r.sessionId,
      score: r.score,
      level: r.level,
      won: r.won,
      coinsAwarded: r.coinsAwarded,
      createdAt: r.createdAt,
    }));
  }

  async updatePlan(id: string, data: Prisma.PlanUpdateInput) {
    await this.prisma.plan.findUniqueOrThrow({ where: { id } }).catch(() => {
      throw new NotFoundException('Plan not found');
    });
    return this.prisma.plan.update({ where: { id }, data });
  }

  redemptions(status?: RedemptionStatus) {
    return this.prisma.redemption.findMany({
      where: status ? { status } : {},
      include: { user: { select: { phone: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Manual payout mode: operator confirms the ETB was sent to the customer's telebirr wallet. */
  async markRedemptionPaid(id: string, payoutRef: string) {
    const r = await this.prisma.redemption.updateMany({
      where: { id, status: RedemptionStatus.PENDING },
      data: {
        status: RedemptionStatus.PAID,
        payoutRef,
        processedAt: new Date(),
      },
    });
    if (r.count === 0)
      throw new BadRequestException(
        'Only pending conversions can be marked paid',
      );
    return this.prisma.redemption.findUniqueOrThrow({ where: { id } });
  }

  /** Rejecting returns the coins to the customer. */
  async rejectRedemption(id: string, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.redemption.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Conversion not found');
      const claimed = await tx.redemption.updateMany({
        where: { id, status: RedemptionStatus.PENDING },
        data: {
          status: RedemptionStatus.REJECTED,
          note,
          processedAt: new Date(),
        },
      });
      if (claimed.count === 0)
        throw new BadRequestException(
          'Only pending conversions can be rejected',
        );
      const user = await tx.user.update({
        where: { id: r.userId },
        data: { coinBalance: { increment: r.coins } },
      });
      await tx.coinTransaction.create({
        data: {
          userId: r.userId,
          type: CoinTxType.REFUND,
          amount: r.coins,
          balanceAfter: user.coinBalance,
          redemptionId: r.id,
          note: `Conversion rejected: ${note}`,
        },
      });
      return tx.redemption.findUniqueOrThrow({ where: { id } });
    });
  }

  tickets(status?: TicketStatus) {
    return this.prisma.supportTicket.findMany({
      where: status ? { status } : {},
      include: { user: { select: { phone: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async updateTicket(
    id: string,
    data: { status?: TicketStatus; response?: string },
  ) {
    await this.prisma.supportTicket
      .findUniqueOrThrow({ where: { id } })
      .catch(() => {
        throw new NotFoundException('Ticket not found');
      });
    return this.prisma.supportTicket.update({ where: { id }, data });
  }
}
