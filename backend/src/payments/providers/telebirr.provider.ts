import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import {
  CheckoutRequest,
  CheckoutResult,
  PaymentNotification,
  PaymentProvider,
  TelebirrIdentity,
} from './payment-provider';
import {
  fieldText,
  nonce,
  signPayload,
  timestamp,
  verifyPayload,
} from './telebirr.crypto';

/**
 * telebirr H5 C2B integration (web checkout + SuperApp single sign-on).
 *
 * Endpoints and field names follow telebirr's merchant integration guide. The final
 * integration architecture, credentials and acceptance criteria must be confirmed with
 * Ethio Telecom / telebirr (proposal section 4.2) before going live.
 */
@Injectable()
export class TelebirrProvider implements PaymentProvider {
  readonly name = 'telebirr' as const;
  private readonly logger = new Logger(TelebirrProvider.name);

  constructor(private readonly config: AppConfig) {}

  private get cfg() {
    return this.config.telebirr;
  }

  private async post<T>(
    path: string,
    body: unknown,
    token?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-APP-Key': this.cfg.fabricAppId,
    };
    if (token) headers.Authorization = token;
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      this.logger.error(
        `telebirr ${path} unreachable: ${(err as Error).message}`,
      );
      throw new BadGatewayException(
        'telebirr is not reachable, please try again',
      );
    }
    const text = await res.text();
    if (!res.ok) {
      this.logger.error(
        `telebirr ${path} HTTP ${res.status}: ${text.slice(0, 500)}`,
      );
      throw new BadGatewayException('telebirr rejected the request');
    }
    return JSON.parse(text) as T;
  }

  /** Step 1 of every call: fabric (access) token. */
  private async fabricToken(): Promise<string> {
    const res = await this.post<{ token?: string }>('/payment/v1/token', {
      appSecret: this.cfg.appSecret,
    });
    if (!res.token)
      throw new BadGatewayException('telebirr did not return a token');
    return res.token;
  }

  private signed(method: string, biz: Record<string, unknown>) {
    const req: Record<string, unknown> = {
      timestamp: timestamp(),
      nonce_str: nonce(),
      method,
      version: '1.0',
      biz_content: biz,
    };
    req.sign = signPayload(req, this.cfg.privateKey);
    req.sign_type = 'SHA256WithRSA';
    return req;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const token = await this.fabricToken();
    const order = this.signed('payment.preorder', {
      notify_url: req.notifyUrl,
      redirect_url: req.redirectUrl,
      appid: this.cfg.merchantAppId,
      merch_code: this.cfg.shortCode,
      merch_order_id: req.merchOrderId,
      trade_type: 'Checkout',
      title: req.title,
      total_amount: (req.amountCents / 100).toFixed(2),
      trans_currency: 'ETB',
      timeout_express: '120m',
      business_type: 'BuyGoods',
      payee_identifier: this.cfg.shortCode,
      payee_identifier_type: '04',
      payee_type: '5000',
      callback_info: 'teleGame',
    });
    const res = await this.post<{
      biz_content?: { prepay_id?: string };
      errorMsg?: string;
    }>('/payment/v1/merchant/preOrder', order, token);
    const prepayId = res.biz_content?.prepay_id;
    if (!prepayId) {
      this.logger.error(
        `preOrder failed for ${req.merchOrderId}: ${JSON.stringify(res).slice(0, 500)}`,
      );
      throw new BadGatewayException('telebirr could not create the payment');
    }

    const raw: Record<string, string> = {
      appid: this.cfg.merchantAppId,
      merch_code: this.cfg.shortCode,
      nonce_str: nonce(),
      prepay_id: prepayId,
      timestamp: timestamp(),
    };
    const sign = signPayload(raw, this.cfg.privateKey);
    const rawRequest = [
      ...Object.entries(raw).map(([k, v]) => `${k}=${v}`),
      `sign=${encodeURIComponent(sign)}`,
      'sign_type=SHA256WithRSA',
    ].join('&');
    return {
      prepayId,
      checkoutUrl: `${this.cfg.webBaseUrl}${rawRequest}&version=1.0&trade_type=Checkout`,
    };
  }

  parseNotification(body: Record<string, unknown>): PaymentNotification {
    const signature = typeof body.sign === 'string' ? body.sign : '';
    if (!signature || !verifyPayload(body, signature, this.cfg.publicKey)) {
      throw new BadRequestException('Invalid telebirr signature');
    }
    const merchOrderId = fieldText(body.merch_order_id);
    if (!merchOrderId) throw new BadRequestException('merch_order_id missing');
    const amount = Number(fieldText(body.total_amount));
    return {
      merchOrderId,
      success: body.trade_status === 'Completed',
      providerTxnId:
        fieldText(body.trans_id) ||
        fieldText(body.payment_order_id) ||
        undefined,
      amountCents: Number.isFinite(amount)
        ? Math.round(amount * 100)
        : undefined,
    };
  }

  async authenticate(authToken: string): Promise<TelebirrIdentity> {
    const token = await this.fabricToken();
    const req = this.signed('payment.authtoken', {
      access_token: authToken,
      trade_type: 'InApp',
      appid: this.cfg.merchantAppId,
      resource_type: 'OpenId',
    });
    const res = await this.post<{
      biz_content?: {
        open_id?: string;
        identifier?: string;
        nickName?: string;
      };
    }>('/payment/v1/auth/authToken', req, token);
    const biz = res.biz_content;
    if (!biz?.open_id) throw new BadGatewayException('telebirr login failed');
    return {
      openId: biz.open_id,
      msisdn: biz.identifier ?? null,
      name: biz.nickName,
    };
  }
}
