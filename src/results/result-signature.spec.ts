import { coinsForScore } from '../common/coins';
import {
  newResultSecret,
  signResult,
  verifyResultSignature,
} from './result-signature';

const rules = {
  coinsPerInterval: 2,
  intervalMinutes: 1,
  maxPerSession: 60,
  maxPerDay: 200,
  perEtb: 100,
  minRedeem: 100,
};

describe('game result signature', () => {
  const secret = newResultSecret();
  const now = Date.UTC(2026, 9, 17, 12, 0, 0);
  const ts = String(now / 1000);
  const body = Buffer.from('{"resultId":"r1","sessionId":"s1","score":1500}');
  const sig = signResult(secret, ts, body);

  it('accepts a correctly signed, recent result', () => {
    expect(verifyResultSignature(secret, ts, sig, body, now)).toEqual({
      ok: true,
    });
  });

  it('rejects a changed body (e.g. inflated score)', () => {
    const forged = Buffer.from(
      '{"resultId":"r1","sessionId":"s1","score":9999999}',
    );
    expect(verifyResultSignature(secret, ts, sig, forged, now)).toEqual({
      ok: false,
      reason: 'MISMATCH',
    });
  });

  it('rejects a signature made with another secret', () => {
    const other = signResult(newResultSecret(), ts, body);
    expect(verifyResultSignature(secret, ts, other, body, now).ok).toBe(false);
  });

  it('rejects replays older than 5 minutes', () => {
    expect(verifyResultSignature(secret, ts, sig, body, now + 301_000)).toEqual(
      {
        ok: false,
        reason: 'STALE',
      },
    );
  });

  it('rejects missing headers', () => {
    expect(verifyResultSignature(secret, undefined, sig, body, now).ok).toBe(
      false,
    );
    expect(verifyResultSignature(secret, ts, undefined, body, now).ok).toBe(
      false,
    );
  });
});

describe('coinsForScore', () => {
  it('pays pointsPerCoin points = 1 coin, rounded down', () => {
    expect(coinsForScore(1550, 100, 0, 0, rules)).toBe(15);
    expect(coinsForScore(99, 100, 0, 0, rules)).toBe(0);
  });

  it('respects the session and daily caps', () => {
    expect(coinsForScore(100_000, 100, 0, 0, rules)).toBe(60);
    expect(coinsForScore(100_000, 100, 50, 0, rules)).toBe(10);
    expect(coinsForScore(100_000, 100, 0, 195, rules)).toBe(5);
    expect(coinsForScore(100_000, 100, 60, 0, rules)).toBe(0);
  });

  it('never pays for negative scores or a zero rate', () => {
    expect(coinsForScore(-500, 100, 0, 0, rules)).toBe(0);
    expect(coinsForScore(500, 0, 0, 0, rules)).toBe(0);
  });
});
