import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { normalizeEthioPhone } from '../../common/phone';
import {
  CheckoutRequest,
  CheckoutResult,
  PaymentNotification,
  PaymentProvider,
  TelebirrIdentity,
} from './payment-provider';
import { fieldText } from './telebirr.crypto';

/**
 * Development stand-in for telebirr. The checkout URL points to the frontend's simulated
 * telebirr payment page, which confirms through POST /api/payments/mock/complete.
 * Never enable in production (PAYMENT_PROVIDER=telebirr).
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  constructor(private readonly config: AppConfig) {}

  createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const url = new URL('/mock-telebirr/checkout', this.config.frontendUrl);
    url.searchParams.set('order', req.merchOrderId);
    return Promise.resolve({
      checkoutUrl: url.toString(),
      prepayId: `MOCK-${req.merchOrderId}`,
    });
  }

  parseNotification(body: Record<string, unknown>): PaymentNotification {
    const merchOrderId = fieldText(body.merch_order_id);
    if (!merchOrderId) throw new BadRequestException('merch_order_id missing');
    return {
      merchOrderId,
      success: body.trade_status === 'Completed',
      providerTxnId: `MOCKTXN${Date.now()}`,
    };
  }

  /**
   * Mock SuperApp token format: "mock-<phone>", e.g. mock-0911223344.
   * Logs in as any number without proof, so it only works with MOCK_TELEBIRR_SSO=true
   * outside production.
   */
  authenticate(authToken: string): Promise<TelebirrIdentity> {
    if (!this.config.mockTelebirrSso) {
      return Promise.reject(
        new UnauthorizedException('telebirr sign-in is not available'),
      );
    }
    const phone = authToken.startsWith('mock-')
      ? normalizeEthioPhone(authToken.slice(5))
      : null;
    if (!phone) {
      return Promise.reject(
        new UnauthorizedException(
          'Invalid mock telebirr token (use mock-09XXXXXXXX)',
        ),
      );
    }
    return Promise.resolve({ openId: `mock-openid-${phone}`, msisdn: phone });
  }
}
