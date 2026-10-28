import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PlanType, Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { AppConfig } from '../config/app-config.service';
import { splitRevenue } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import {
  PAYMENT_PROVIDER,
  type PaymentNotification,
  type PaymentProvider,
} from './providers/payment-provider';

const PLAN_LABEL: Record<PlanType, string> = {
  DAILY: 'Daily subscription',
  WEEKLY: 'Weekly subscription',
  MONTHLY: 'Monthly subscription',
  PAY_PER_USE: 'Pay-per-use',
};

/**
 * Journey step 3: customer completes the purchase/subscription flow.
 * Journey step 4: payment is processed through the approved telebirr integration.
 * On success the order is fulfilled atomically: revenue split recorded + entitlement granted (step 5).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly entitlements: EntitlementsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async checkout(userId: string, planId: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: { game: true },
    });
    if (!plan || !plan.isActive || !plan.game.isActive)
      throw new NotFoundException('This plan is not available');

    const merchOrderId = `TG${Date.now()}${randomInt(100000, 999999)}`;
    const order = await this.prisma.order.create({
      data: {
        merchOrderId,
        userId,
        gameId: plan.gameId,
        planId: plan.id,
        planType: plan.type,
        amountCents: plan.priceCents,
        provider: this.provider.name,
      },
    });

    try {
      const result = await this.provider.createCheckout({
        merchOrderId,
        title: `${plan.game.title} - ${PLAN_LABEL[plan.type]}`,
        amountCents: plan.priceCents,
        notifyUrl: `${this.config.publicApiUrl}/api/payments/telebirr/notify`,
        redirectUrl: `${this.config.frontendUrl}/payment/result?order=${merchOrderId}`,
      });
      await this.prisma.order.update({
        where: { id: order.id },
        data: { checkoutUrl: result.checkoutUrl, prepayId: result.prepayId },
      });
      return {
        orderId: order.id,
        merchOrderId,
        amountCents: plan.priceCents,
        checkoutUrl: result.checkoutUrl,
      };
    } catch (err) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.FAILED },
      });
      throw err;
    }
  }

  /** telebirr server-to-server notification (notify_url). */
  async handleProviderNotification(body: Record<string, unknown>) {
    // The simulated provider has no signature, so its notifications are never accepted from
    // the public callback URL — otherwise anyone could mark any order as paid.
    if (this.provider.name !== 'telebirr') {
      throw new ForbiddenException('Payment notifications are not enabled');
    }
    const notification = this.provider.parseNotification(body);
    await this.fulfil(notification, body);
    return { code: 0, msg: 'success' };
  }

  /** Development only: the simulated telebirr checkout page confirms or cancels here. */
  async completeMock(userId: string, merchOrderId: string, success: boolean) {
    if (this.provider.name !== 'mock')
      throw new ForbiddenException('Mock payments are disabled');
    const order = await this.prisma.order.findUnique({
      where: { merchOrderId },
    });
    if (!order || order.userId !== userId)
      throw new NotFoundException('Order not found');
    if (success) {
      const body = { merch_order_id: merchOrderId, trade_status: 'Completed' };
      await this.fulfil(this.provider.parseNotification(body), body);
    } else {
      await this.prisma.order.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED },
      });
    }
    return this.getOrder(userId, merchOrderId);
  }

  private async fulfil(n: PaymentNotification, raw: Record<string, unknown>) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { merchOrderId: n.merchOrderId },
      });
      if (!order)
        throw new NotFoundException(`Unknown order ${n.merchOrderId}`);
      if (order.status !== OrderStatus.PENDING) return; // idempotent: notifications can repeat

      const raw_ = raw as Prisma.InputJsonValue;
      if (!n.success) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.FAILED, rawNotification: raw_ },
        });
        return;
      }
      // a real telebirr confirmation must state the amount paid, and it must match the order
      const amountMissing =
        this.provider.name === 'telebirr' && n.amountCents === undefined;
      if (
        amountMissing ||
        (n.amountCents !== undefined && n.amountCents !== order.amountCents)
      ) {
        this.logger.error(
          `Amount mismatch on ${order.merchOrderId}: paid ${n.amountCents}, expected ${order.amountCents}`,
        );
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.FAILED, rawNotification: raw_ },
        });
        return;
      }

      const split = splitRevenue(order.amountCents, this.config.revenue);
      // guarded update: only one concurrent notification can move PENDING -> PAID
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING },
        data: {
          status: OrderStatus.PAID,
          paidAt: new Date(),
          providerTxnId: n.providerTxnId,
          rawNotification: raw_,
          vatCents: split.vatCents,
          otherTaxCents: split.otherTaxCents,
          netCents: split.netCents,
          partnerShareCents: split.partnerShareCents,
          operatorShareCents: split.operatorShareCents,
        },
      });
      if (claimed.count === 1) await this.entitlements.grantForOrder(tx, order);
    });
  }

  async getOrder(userId: string, merchOrderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { merchOrderId },
      include: {
        game: { select: { slug: true, title: true } },
        entitlement: true,
      },
    });
    if (!order || order.userId !== userId)
      throw new NotFoundException('Order not found');
    return {
      merchOrderId: order.merchOrderId,
      status: order.status,
      planType: order.planType,
      amountCents: order.amountCents,
      game: order.game,
      paidAt: order.paidAt,
      entitlement: order.entitlement && {
        type: order.entitlement.type,
        startsAt: order.entitlement.startsAt,
        expiresAt: order.entitlement.expiresAt,
        playsRemaining: order.entitlement.playsRemaining,
      },
    };
  }

  async myOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: { game: { select: { slug: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return orders.map((o) => ({
      merchOrderId: o.merchOrderId,
      status: o.status,
      planType: o.planType,
      amountCents: o.amountCents,
      game: o.game,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
    }));
  }

  /** For the simulated checkout page: amount and title of an order still awaiting payment. */
  async pendingCheckoutInfo(userId: string, merchOrderId: string) {
    const o = await this.getOrder(userId, merchOrderId);
    if (o.status !== OrderStatus.PENDING)
      throw new BadRequestException(
        `Order is already ${o.status.toLowerCase()}`,
      );
    return { ...o, title: `${o.game.title} - ${PLAN_LABEL[o.planType]}` };
  }
}
