import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CoinTxType, RedemptionStatus } from '@prisma/client';
import { randomInt } from 'crypto';
import { AppConfig } from '../config/app-config.service';
import { coinsToCents } from '../common/coins';
import { startOfAddisDay } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { CoinSettingsService } from '../settings/coin-settings.service';

/**
 * Journey step 8: customer converts accumulated coins into ETB / e-money.
 * Coins are debited atomically, a redemption is recorded and the ETB is paid
 * to the customer's telebirr wallet (instantly with PAYOUT_PROVIDER=mock,
 * or after an operator disburses it with PAYOUT_PROVIDER=manual).
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly coinSettings: CoinSettingsService,
  ) {}

  async summary(userId: string) {
    const rules = await this.coinSettings.rules();
    const [user, earned] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.coinTransaction.aggregate({
        where: {
          userId,
          type: CoinTxType.EARN,
          createdAt: { gte: startOfAddisDay() },
        },
        _sum: { amount: true },
      }),
    ]);
    return {
      coinBalance: user.coinBalance,
      etbValueCents: coinsToCents(user.coinBalance, rules),
      payoutMsisdn: user.phone,
      earnedToday: earned._sum.amount ?? 0,
      rules: {
        coinsPerEtb: rules.perEtb,
        minRedeemCoins: rules.minRedeem,
        coinsPerInterval: rules.coinsPerInterval,
        intervalMinutes: rules.intervalMinutes,
        maxCoinsPerSession: rules.maxPerSession,
        maxCoinsPerDay: rules.maxPerDay,
        instantPayout: this.config.payoutProvider === 'mock',
      },
    };
  }

  async transactions(userId: string) {
    return this.prisma.coinTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        note: true,
        createdAt: true,
      },
    });
  }

  async redemptions(userId: string) {
    return this.prisma.redemption.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async convert(userId: string, coins: number) {
    const rules = await this.coinSettings.rules();
    if (!Number.isInteger(coins) || coins < rules.minRedeem) {
      throw new BadRequestException(
        `You can convert from ${rules.minRedeem} coins`,
      );
    }
    const amountCents = coinsToCents(coins, rules);
    if (amountCents <= 0)
      throw new BadRequestException('Amount too small to convert');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.phone)
      throw new BadRequestException(
        'A telebirr phone number is required to receive e-money',
      );

    const redemption = await this.prisma.$transaction(async (tx) => {
      const debited = await tx.user.updateMany({
        where: { id: userId, coinBalance: { gte: coins } },
        data: { coinBalance: { decrement: coins } },
      });
      if (debited.count === 0)
        throw new BadRequestException('Not enough coins');
      const after = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const r = await tx.redemption.create({
        data: { userId, coins, amountCents, msisdn: user.phone! },
      });
      await tx.coinTransaction.create({
        data: {
          userId,
          type: CoinTxType.REDEEM,
          amount: -coins,
          balanceAfter: after.coinBalance,
          redemptionId: r.id,
          note: `Converted to ${(amountCents / 100).toFixed(2)} ETB`,
        },
      });
      return r;
    });

    if (this.config.payoutProvider === 'mock') {
      return this.prisma.redemption.update({
        where: { id: redemption.id },
        data: {
          status: RedemptionStatus.PAID,
          payoutRef: `MOCKPAY${Date.now()}${randomInt(1000, 9999)}`,
          processedAt: new Date(),
        },
      });
    }
    this.logger.log(
      `Redemption ${redemption.id} queued for manual telebirr payout`,
    );
    return redemption;
  }
}
