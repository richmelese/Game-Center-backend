/**
 * Normalizes an Ethio telecom (telebirr) mobile number to 2519XXXXXXXX.
 * Accepts 09XXXXXXXX, 9XXXXXXXX, 2519XXXXXXXX and +2519XXXXXXXX (spaces/dashes ignored).
 * Returns null when the number is not a valid Ethio telecom mobile number.
 */
export function normalizeEthioPhone(input: string): string | null {
  const digits = (input ?? '').replace(/[\s\-()]/g, '').replace(/^\+/, '');
  let local: string | null = null;
  if (/^2519\d{8}$/.test(digits)) local = digits.slice(3);
  else if (/^09\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^9\d{8}$/.test(digits)) local = digits;
  return local ? `251${local}` : null;
}

export function maskPhone(msisdn: string): string {
  return msisdn.length > 6
    ? `${msisdn.slice(0, 6)}****${msisdn.slice(-2)}`
    : msisdn;
}
