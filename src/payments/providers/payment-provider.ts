/** Contract every payment integration must satisfy (journey step 4). */
export interface CheckoutRequest {
  merchOrderId: string;
  title: string;
  amountCents: number;
  notifyUrl: string;
  redirectUrl: string;
  /**
   * 'web': H5 browser redirect to telebirr's hosted checkout page (trade_type Checkout).
   * 'inApp': signed payload for the SuperApp's native payment bridge (trade_type InApp) —
   * used when the customer opened the Game Center from inside the telebirr SuperApp.
   */
  mode: 'web' | 'inApp';
}

export interface CheckoutResult {
  prepayId: string;
  /** Set when mode was 'web': browser redirect target. */
  checkoutUrl?: string;
  /** Set when mode was 'inApp': hand this to the SuperApp's native pay bridge function. */
  nativeRawRequest?: string;
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
  readonly name: 'telebirr';
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Validates the provider callback (signature etc.) and normalizes it. Throws when invalid. */
  parseNotification(body: Record<string, unknown>): PaymentNotification;
  /** telebirr SuperApp single sign-on: exchanges the mini-app authToken for the customer's identity. */
  authenticate(authToken: string): Promise<TelebirrIdentity>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
