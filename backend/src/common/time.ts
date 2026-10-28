/** Ethiopia uses East Africa Time (UTC+3, no daylight saving). Daily limits reset at local midnight. */
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function startOfAddisDay(now = new Date()): Date {
  const local = new Date(now.getTime() + EAT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - EAT_OFFSET_MS);
}

export const addHours = (d: Date, hours: number) =>
  new Date(d.getTime() + hours * 3_600_000);
