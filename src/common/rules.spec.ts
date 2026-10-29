import { coinsForSession, coinsToCents } from './coins';
import { splitRevenue } from './money';
import { normalizeEthioPhone } from './phone';
import { startOfAddisDay } from './time';

const revenueRules = {
  pricesIncludeVat: true,
  vatRate: 0.15,
  otherTaxRate: 0,
  partnerShare: 0.7,
};
const coinRules = {
  coinsPerInterval: 2,
  intervalMinutes: 1,
  maxPerSession: 60,
  maxPerDay: 200,
  perEtb: 100,
  minRedeem: 100,
};

describe('splitRevenue (proposal 3.2)', () => {
  it('splits a 45 ETB monthly subscription 70/30 after VAT', () => {
    const s = splitRevenue(4500, revenueRules);
    expect(s.vatCents).toBe(587); // 45 * 0.15 / 1.15 = 5.87
    expect(s.netCents).toBe(3913);
    expect(s.partnerShareCents).toBe(2739);
    expect(s.operatorShareCents).toBe(1174);
    expect(s.partnerShareCents + s.operatorShareCents).toBe(s.netCents);
  });

  it('always keeps gross = vat + other tax + net', () => {
    for (const gross of [100, 300, 1000, 4500, 9999]) {
      const s = splitRevenue(gross, { ...revenueRules, otherTaxRate: 0.02 });
      expect(s.vatCents + s.otherTaxCents + s.netCents).toBe(gross);
      expect(s.partnerShareCents + s.operatorShareCents).toBe(s.netCents);
    }
  });

  it('adds VAT on top when prices exclude VAT', () => {
    const s = splitRevenue(1000, { ...revenueRules, pricesIncludeVat: false });
    expect(s.vatCents).toBe(150);
    expect(s.netCents).toBe(1000);
  });

  it('rejects fractional santim', () => {
    expect(() => splitRevenue(1.5, revenueRules)).toThrow();
  });
});

describe('coins (journey steps 7-8)', () => {
  it('earns per full minute of active play', () => {
    expect(coinsForSession(59, 0, coinRules)).toBe(0);
    expect(coinsForSession(5 * 60 + 30, 0, coinRules)).toBe(10);
  });

  it('caps per session and per day', () => {
    expect(coinsForSession(3600, 0, coinRules)).toBe(60);
    expect(coinsForSession(3600, 180, coinRules)).toBe(20);
    expect(coinsForSession(3600, 250, coinRules)).toBe(0);
  });

  it('uses the admin rate: X coins for every completed Y minutes', () => {
    const fivePerTwoMin = {
      ...coinRules,
      coinsPerInterval: 5,
      intervalMinutes: 2,
    };
    expect(coinsForSession(119, 0, fivePerTwoMin)).toBe(0); // under 2 minutes
    expect(coinsForSession(120, 0, fivePerTwoMin)).toBe(5);
    expect(coinsForSession(10 * 60, 0, fivePerTwoMin)).toBe(25);
    expect(coinsForSession(11 * 60 + 59, 0, fivePerTwoMin)).toBe(25); // partial interval not paid
    expect(coinsForSession(60 * 60, 0, fivePerTwoMin)).toBe(60); // still capped per session
  });

  it('converts coins to ETB rounding down', () => {
    expect(coinsToCents(100, coinRules)).toBe(100); // 1.00 ETB
    expect(coinsToCents(250, coinRules)).toBe(250);
    expect(coinsToCents(1, { perEtb: 3 })).toBe(33);
  });
});

describe('normalizeEthioPhone', () => {
  it.each([
    ['0911223344', '251911223344'],
    ['911223344', '251911223344'],
    ['+251 911 22 33 44', '251911223344'],
    ['251911223344', '251911223344'],
  ])('%s -> %s', (input, expected) =>
    expect(normalizeEthioPhone(input)).toBe(expected),
  );

  it.each(['0711223344', '12345', '09112233445', ''])('rejects %s', (input) =>
    expect(normalizeEthioPhone(input)).toBeNull(),
  );
});

describe('startOfAddisDay', () => {
  it('uses UTC+3 midnight', () => {
    // 2026-10-17 22:30 UTC is already 2026-10-18 01:30 in Addis Ababa
    expect(
      startOfAddisDay(new Date('2026-10-17T22:30:00Z')).toISOString(),
    ).toBe('2026-10-17T21:00:00.000Z');
    expect(
      startOfAddisDay(new Date('2026-10-17T20:00:00Z')).toISOString(),
    ).toBe('2026-10-16T21:00:00.000Z');
  });
});
