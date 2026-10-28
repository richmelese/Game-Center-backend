import {
  constants,
  randomBytes,
  sign as rsaSign,
  verify as rsaVerify,
} from 'crypto';

/**
 * telebirr request signing (SHA256WithRSA, RSA-PSS / MGF1).
 * Fields are flattened (top level + biz_content), excluded fields removed,
 * sorted by key and joined as key=value pairs with '&'.
 */
const EXCLUDED = new Set([
  'sign',
  'sign_type',
  'header',
  'refund_info',
  'openType',
  'raw_request',
  'biz_content',
  'wallet_reference_data',
]);

/** String value of a scalar callback/request field; '' for missing or non-scalar values. */
export const fieldText = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    ? String(v)
    : '';

export function buildSignString(payload: Record<string, unknown>): string {
  const fields: Record<string, string> = {};
  const add = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (EXCLUDED.has(k)) continue;
      const text = fieldText(v);
      if (text !== '') fields[k] = text;
    }
  };
  add(payload);
  const biz = payload.biz_content;
  if (biz && typeof biz === 'object') add(biz as Record<string, unknown>);
  return Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('&');
}

const PSS = {
  padding: constants.RSA_PKCS1_PSS_PADDING,
  saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
};

export function signPayload(
  payload: Record<string, unknown>,
  privateKeyPem: string,
): string {
  const data = Buffer.from(buildSignString(payload), 'utf8');
  return rsaSign('sha256', data, { key: privateKeyPem, ...PSS }).toString(
    'base64',
  );
}

export function verifyPayload(
  payload: Record<string, unknown>,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const data = Buffer.from(buildSignString(payload), 'utf8');
    return rsaVerify(
      'sha256',
      data,
      { key: publicKeyPem, ...PSS },
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export const nonce = () => randomBytes(16).toString('hex'); // 32 chars
export const timestamp = () => Math.floor(Date.now() / 1000).toString();
