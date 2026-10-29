import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CoinRules } from '../common/coins';

/** Typed access to the business rules defined in the proposal (see .env.example). */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService) {}

  private str(key: string, fallback?: string): string {
    const v = this.config.get<string>(key);
    if (v === undefined || v === '') {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing required environment variable ${key}`);
    }
    return v;
  }

  private num(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n))
      throw new Error(`Environment variable ${key} must be a number`);
    return n;
  }

  private bool(key: string, fallback: boolean): boolean {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === '') return fallback;
    return raw.toLowerCase() === 'true';
  }

  get port() {
    return this.num('PORT', 4000);
  }
  get frontendUrl() {
    return this.str('FRONTEND_URL', 'http://localhost:3000');
  }
  /** Where the hosted HTML5 games live (e.g. http://localhost:8642); no trailing slash. */
  get gamesBaseUrl() {
    return this.str('GAMES_BASE_URL', 'http://telegames.196.189.126.55.nip.io').replace(
      /\/+$/,
      '',
    );
  }
  /** Game links and pictures stored as paths ("/games/...") are served from GAMES_BASE_URL. */
  gameAssetUrl(pathOrUrl: string): string;
  gameAssetUrl(pathOrUrl: string | null): string | null;
  gameAssetUrl(pathOrUrl: string | null) {
    if (!pathOrUrl) return null;
    return pathOrUrl.startsWith('/')
      ? `${this.gamesBaseUrl}${pathOrUrl}`
      : pathOrUrl;
  }
  get publicApiUrl() {
    return this.str('PUBLIC_API_URL', 'http://localhost:4000');
  }
  get jwtSecret() {
    return this.str('JWT_SECRET');
  }
  get jwtExpiresIn() {
    return this.str('JWT_EXPIRES_IN', '7d');
  }
  get isProduction() {
    return this.config.get<string>('NODE_ENV') === 'production';
  }
  /** Development only: return the login code in the API response. Never in production. */
  get otpDevEcho() {
    return !this.isProduction && this.bool('OTP_DEV_ECHO', false);
  }
  /** Number of reverse proxies in front of the API (for the client IP used by rate limits). */
  get trustProxyHops() {
    return this.num('TRUST_PROXY_HOPS', 0);
  }
  get adminTokenTtl() {
    return this.str('ADMIN_JWT_EXPIRES_IN', '8h');
  }

  /** Refuses to start a production server with development shortcuts or weak secrets. */
  assertProductionSafe() {
    if (!this.isProduction) return;
    const problems: string[] = [];
    if (this.payoutProvider === 'mock')
      problems.push('PAYOUT_PROVIDER=mock (simulated payouts)');
    if (this.bool('OTP_DEV_ECHO', false)) problems.push('OTP_DEV_ECHO=true');
    if (this.config.get<string>('ADMIN_PASSWORD') === 'ChangeMe123!') {
      problems.push('ADMIN_PASSWORD is still the default');
    }
    if (/^https?:\/\/localhost/.test(this.frontendUrl))
      problems.push('FRONTEND_URL points to localhost');
    if (problems.length) {
      throw new Error(
        `Refusing to start in production:\n - ${problems.join('\n - ')}`,
      );
    }
  }

  get revenue() {
    return {
      pricesIncludeVat: this.bool('PRICES_INCLUDE_VAT', true),
      vatRate: this.num('VAT_RATE', 0.15),
      otherTaxRate: this.num('OTHER_TAX_RATE', 0),
      partnerShare: this.num('PARTNER_SHARE', 0.7),
    };
  }

  get demo() {
    return {
      playsPerDay: this.num('DEMO_PLAYS_PER_DAY', 3),
      seconds: this.num('DEMO_SECONDS', 180),
    };
  }

  /** Initial coin rules only; admins change them later in Coin settings (CoinSettingsService). */
  get defaultCoinRules(): CoinRules {
    return {
      coinsPerInterval: this.num('COINS_PER_MINUTE', 2),
      intervalMinutes: 1,
      maxPerSession: this.num('MAX_COINS_PER_SESSION', 60),
      maxPerDay: this.num('MAX_COINS_PER_DAY', 200),
      perEtb: this.num('COINS_PER_ETB', 100),
      minRedeem: this.num('MIN_REDEEM_COINS', 100),
    };
  }

  get paymentProvider(): 'telebirr' {
    const p = this.str('PAYMENT_PROVIDER', 'telebirr');
    if (p !== 'telebirr') throw new Error('PAYMENT_PROVIDER must be telebirr');
    return p;
  }

  get payoutProvider(): 'mock' | 'manual' {
    const p = this.str('PAYOUT_PROVIDER', 'mock');
    if (p !== 'mock' && p !== 'manual')
      throw new Error('PAYOUT_PROVIDER must be mock or manual');
    return p;
  }

  get telebirr() {
    const pem = (k: string, fallback?: string) =>
      this.str(k, fallback).replace(/\\n/g, '\n');
    return {
      baseUrl: this.str('TELEBIRR_BASE_URL'),
      webBaseUrl: this.str('TELEBIRR_WEB_BASE_URL'),
      fabricAppId: this.str('TELEBIRR_FABRIC_APP_ID'),
      appSecret: this.str('TELEBIRR_APP_SECRET'),
      merchantAppId: this.str('TELEBIRR_MERCHANT_APP_ID'),
      shortCode: this.str('TELEBIRR_SHORT_CODE'),
      privateKey: pem('TELEBIRR_PRIVATE_KEY'),
      // not yet issued by telebirr; only parseNotification() needs it, not checkout
      publicKey: pem('TELEBIRR_PUBLIC_KEY', ''),
    };
  }
}
