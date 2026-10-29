/** Ethiopia uses East Africa Time (UTC+3, no daylight saving). Daily limits reset at local midnight. */
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function startOfAddisDay(now = new Date()): Date {
  const local = new Date(now.getTime() + EAT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - EAT_OFFSET_MS);
}

export const addHours = (d: Date, hours: number) =>
  new Date(d.getTime() + hours * 3_600_000);

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parses a JWT-style duration ("7d", "8h") into milliseconds, for cookie maxAge. */
export function msFromDuration(duration: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(duration);
  if (!m) throw new Error(`Invalid duration "${duration}"`);
  return Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
}
