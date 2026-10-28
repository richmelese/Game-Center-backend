import { BadRequestException, Injectable } from '@nestjs/common';
import { CoinSettings } from '@prisma/client';
import { AppConfig } from '../config/app-config.service';
import { CoinRules } from '../common/coins';
import { PrismaService } from '../prisma/prisma.service';

/** How long a read of the rules is reused; an admin save clears it at once on this server. */
const CACHE_MS = 15_000;

export interface CoinSettingsInput {
  coinsPerInterval: number;
  intervalMinutes: number;
  maxPerSession: number;
  maxPerDay: number;
  coinsPerEtb: number;
  minRedeem: number;
}

/**
 * Coin rules set by admins (Admin → Coin settings): how many coins are paid for how many
 * minutes of play, the session/daily limits and the ETB conversion rate.
 * Stored as a single database row, created from the .env defaults on first use.
 */
@Injectable()
export class CoinSettingsService {
  private cache: { rules: CoinRules; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  private toRules(s: CoinSettings): CoinRules {
    return {
      coinsPerInterval: s.coinsPerInterval,
      intervalMinutes: s.intervalMinutes,
      maxPerSession: s.maxPerSession,
      maxPerDay: s.maxPerDay,
      perEtb: s.coinsPerEtb,
      minRedeem: s.minRedeem,
    };
  }

  private async row(): Promise<CoinSettings> {
    const existing = await this.prisma.coinSettings.findUnique({
      where: { id: 1 },
    });
    if (existing) return existing;
    const d = this.config.defaultCoinRules;
    return this.prisma.coinSettings.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        coinsPerInterval: d.coinsPerInterval,
        intervalMinutes: d.intervalMinutes,
        maxPerSession: d.maxPerSession,
        maxPerDay: d.maxPerDay,
        coinsPerEtb: d.perEtb,
        minRedeem: d.minRedeem,
      },
    });
  }

  /** Current rules used by play, score results and the wallet. */
  async rules(): Promise<CoinRules> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS)
      return this.cache.rules;
    const rules = this.toRules(await this.row());
    this.cache = { rules, at: Date.now() };
    return rules;
  }

  /** Admin view, including who changed it last and when. */
  async get() {
    const s = await this.row();
    const updatedBy = s.updatedById
      ? await this.prisma.user.findUnique({
          where: { id: s.updatedById },
          select: { email: true, name: true },
        })
      : null;
    return {
      coinsPerInterval: s.coinsPerInterval,
      intervalMinutes: s.intervalMinutes,
      maxPerSession: s.maxPerSession,
      maxPerDay: s.maxPerDay,
      coinsPerEtb: s.coinsPerEtb,
      minRedeem: s.minRedeem,
      updatedAt: s.updatedAt,
      updatedBy: updatedBy?.email ?? updatedBy?.name ?? null,
    };
  }

  async update(input: CoinSettingsInput, adminId: string) {
    if (input.maxPerDay < input.maxPerSession) {
      throw new BadRequestException(
        'Coins per day must be at least the coins per session',
      );
    }
    await this.row(); // make sure the row exists
    await this.prisma.coinSettings.update({
      where: { id: 1 },
      data: { ...input, updatedById: adminId },
    });
    this.cache = null;
    return this.get();
  }
}
