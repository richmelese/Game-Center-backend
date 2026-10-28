/** Contract every payment integration must satisfy (journey step 4). */
export interface CheckoutRequest {
  merchOrderId: string;
  title: string;
  amountCents: number;
  notifyUrl: string;
  redirectUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  prepayId?: string;
}

export interface PaymentNotification {
  merchOrderId: string;
  success: boolean;
  providerTxnId?: string;
  /** Amount reported by the provider, used to cross-check the order. */
  amountCents?: number;
}

export interface TelebirrIdentity {
  openId: string;
  msisdn: string | null;
  name?: string;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'telebirr';
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Validates the provider callback (signature etc.) and normalizes it. Throws when invalid. */
  parseNotification(body: Record<string, unknown>): PaymentNotification;
  /** telebirr SuperApp single sign-on: exchanges the mini-app authToken for the customer's identity. */
  authenticate(authToken: string): Promise<TelebirrIdentity>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
