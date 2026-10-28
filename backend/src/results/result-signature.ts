import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Signature on game results sent by the game supplier's server:
 *
 *   X-TG-Timestamp: <unix seconds>
 *   X-TG-Signature: hex( HMAC-SHA256( secret, "<timestamp>.<raw request body>" ) )
 *
 * The timestamp is part of the signed data and must be recent, so a captured
 * request cannot be replayed later.
 */
export const MAX_CLOCK_SKEW_SECONDS = 300;

export function signResult(
  secret: string,
  timestamp: string,
  rawBody: string | Buffer,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}

export type SignatureCheck =
  { ok: true } | { ok: false; reason: 'MISSING' | 'STALE' | 'MISMATCH' };

export function verifyResultSignature(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: Buffer | undefined,
  nowMs = Date.now(),
): SignatureCheck {
  if (!timestamp || !signature || !rawBody)
    return { ok: false, reason: 'MISSING' };
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: 'STALE' };
  const skew = Math.abs(nowMs / 1000 - Number(timestamp));
  if (skew > MAX_CLOCK_SKEW_SECONDS) return { ok: false, reason: 'STALE' };
  if (!/^[0-9a-f]{64}$/i.test(signature))
    return { ok: false, reason: 'MISMATCH' };
  const expected = Buffer.from(signResult(secret, timestamp, rawBody), 'hex');
  const given = Buffer.from(signature, 'hex');
  return timingSafeEqual(expected, given)
    ? { ok: true }
    : { ok: false, reason: 'MISMATCH' };
}

export const newResultSecret = () => randomBytes(32).toString('hex');
