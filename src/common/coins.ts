export interface CoinRules {
  /** TIME mode: `coinsPerInterval` coins for every completed `intervalMinutes` of play */
  coinsPerInterval: number;
  intervalMinutes: number;
  maxPerSession: number;
  maxPerDay: number;
  perEtb: number;
  minRedeem: number;
}

export function coinsForSession(
  activeSeconds: number,
  earnedTodayBefore: number,
  rules: CoinRules,
): number {
  const intervalSeconds = Math.max(1, rules.intervalMinutes) * 60;
  const byTime =
    Math.floor(Math.max(0, activeSeconds) / intervalSeconds) *
    rules.coinsPerInterval;
  const leftToday = Math.max(0, rules.maxPerDay - earnedTodayBefore);
  return Math.max(0, Math.min(byTime, rules.maxPerSession, leftToday));
}

/**
 * SCORE mode: coins for one reported result, `pointsPerCoin` points = 1 coin,
 * still bounded by what is left of the session and daily caps.
 */
export function coinsForScore(
  score: number,
  pointsPerCoin: number,
  sessionEarnedBefore: number,
  earnedTodayBefore: number,
  rules: CoinRules,
): number {
  if (pointsPerCoin <= 0) return 0;
  const byScore = Math.floor(Math.max(0, score) / pointsPerCoin);
  const leftSession = Math.max(0, rules.maxPerSession - sessionEarnedBefore);
  const leftToday = Math.max(0, rules.maxPerDay - earnedTodayBefore);
  return Math.max(0, Math.min(byScore, leftSession, leftToday));
}

/** ETB value (in santim) of a number of coins, rounded down to the santim. */
export function coinsToCents(
  coins: number,
  rules: Pick<CoinRules, 'perEtb'>,
): number {
  return Math.floor((coins * 100) / rules.perEtb);
}
