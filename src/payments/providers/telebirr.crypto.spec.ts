import { generateKeyPairSync } from 'crypto';
import { buildSignString, signPayload, verifyPayload } from './telebirr.crypto';

describe('telebirr signing', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const request = {
    timestamp: '1760000000',
    nonce_str: 'abc',
    method: 'payment.preorder',
    version: '1.0',
    biz_content: { merch_order_id: 'TG1', total_amount: '3.00', appid: 'X' },
    sign_type: 'SHA256WithRSA',
  };

  it('flattens biz_content, drops excluded fields and sorts keys', () => {
    expect(buildSignString(request)).toBe(
      'appid=X&merch_order_id=TG1&method=payment.preorder&nonce_str=abc&timestamp=1760000000&total_amount=3.00&version=1.0',
    );
  });

  it('round-trips a signature and detects tampering', () => {
    const sign = signPayload(request, privateKey);
    expect(verifyPayload({ ...request, sign }, sign, publicKey)).toBe(true);
    const tampered = {
      ...request,
      biz_content: { ...request.biz_content, total_amount: '0.01' },
    };
    expect(verifyPayload(tampered, sign, publicKey)).toBe(false);
  });
});
