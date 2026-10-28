import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';

const scrypt = (pw: string, salt: Buffer, len: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, len, (err, key) => (err ? reject(err) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algo, saltHex, keyHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(
    password,
    Buffer.from(saltHex, 'hex'),
    expected.length,
  );
  return timingSafeEqual(expected, actual);
}
