import { Injectable, NotFoundException } from '@nestjs/common';
import { Game, Plan, PlanType } from '@prisma/client';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CoinSettingsService } from '../settings/coin-settings.service';
import { EntitlementsService } from '../entitlements/entitlements.service';

const PLAN_ORDER: PlanType[] = [
  PlanType.DAILY,
  PlanType.WEEKLY,
  PlanType.MONTHLY,
  PlanType.PAY_PER_USE,
];

export const planView = (p: Plan) => ({
  id: p.id,
  type: p.type,
  priceCents: p.priceCents,
  durationHours: p.durationHours,
  plays: p.plays,
});

const gameView = (g: Game & { plans: Plan[] }, config: AppConfig) => ({
  id: g.id,
  slug: g.slug,
  title: g.title,
  category: g.category,
  description: g.description,
  targetAudience: g.targetAudience,
  themeColor: g.themeColor,
  imageUrl: config.gameAssetUrl(g.imageUrl),
  coinMode: g.coinMode,
  pointsPerCoin: g.pointsPerCoin,
  plans: g.plans
    .filter((p) => p.isActive)
    .sort((a, b) => PLAN_ORDER.indexOf(a.type) - PLAN_ORDER.indexOf(b.type))
    .map(planView),
});

/** Journey step 2: customer discovers / selects an available game. */
@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly coinSettings: CoinSettingsService,
    private readonly config: AppConfig,
  ) {}

  /** Current play-time rate set by admins, e.g. { coins: 2, minutes: 1 } */
  private async timeCoins() {
    const r = await this.coinSettings.rules();
    return { coins: r.coinsPerInterval, minutes: r.intervalMinutes };
  }

  async list(category?: string) {
    const games = await this.prisma.game.findMany({
      where: { isActive: true, ...(category ? { category } : {}) },
      include: { plans: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
    const all = await this.prisma.game.findMany({
      where: { isActive: true },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return {
      categories: all.map((c) => c.category),
      games: games.map((g) => gameView(g, this.config)),
      timeCoins: await this.timeCoins(),
    };
  }

  async detail(slug: string, userId?: string) {
    const game = await this.prisma.game.findUnique({
      where: { slug },
      include: { plans: true },
    });
    if (!game || !game.isActive) throw new NotFoundException('Game not found');
    const access = userId
      ? await this.entitlements.access(userId, game.id)
      : null;
    return {
      ...gameView(game, this.config),
      access,
      timeCoins: await this.timeCoins(),
    };
  }
}
