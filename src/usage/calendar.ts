export interface DayRange {
  startDay: string;
  endDay: string;
  label: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function detectReportingTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function localDayFromEpochMs(epochMs: number, timeZone: string): string {
  const parts = getFormatter(timeZone).formatToParts(new Date(epochMs));
  let year = "";
  let month = "";
  let day = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = part.value;
  }
  if (!year || !month || !day) throw new Error(`Unable to derive local day for timezone ${timeZone}`);
  return `${year}-${month}-${day}`;
}

export function todayRange(nowMs: number, timeZone: string): DayRange {
  const today = localDayFromEpochMs(nowMs, timeZone);
  return { startDay: today, endDay: today, label: "Today" };
}

export function lastCalendarDaysRange(days: number, nowMs: number, timeZone: string): DayRange {
  if (!Number.isInteger(days) || days < 1) throw new Error("days must be a positive integer");
  const endDay = localDayFromEpochMs(nowMs, timeZone);
  const startDay = addDays(endDay, -(days - 1));
  return { startDay, endDay, label: `Last ${days} days` };
}

export function thisMonthRange(nowMs: number, timeZone: string): DayRange {
  const endDay = localDayFromEpochMs(nowMs, timeZone);
  return { startDay: `${endDay.slice(0, 7)}-01`, endDay, label: "This month" };
}

export function previousMonthRange(nowMs: number, timeZone: string): DayRange {
  const today = localDayFromEpochMs(nowMs, timeZone);
  const [year, month] = today.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const startDay = formatUtcDate(previous);
  const endDay = formatUtcDate(new Date(Date.UTC(year, month - 1, 0)));
  return { startDay, endDay, label: "Previous month" };
}

export function weekRangeForDay(day: string): DayRange {
  const date = parseDay(day);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const startDay = addDays(day, mondayOffset);
  return { startDay, endDay: addDays(startDay, 6), label: `Week of ${startDay}` };
}

export function addDays(day: string, delta: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + delta);
  return formatUtcDate(date);
}

export function compareDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isValidDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return formatUtcDate(parseDay(value)) === value;
  } catch {
    return false;
  }
}

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function parseDay(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid day: ${day}`);
  const [year, month, date] = day.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, date));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== date
  ) {
    throw new Error(`Invalid day: ${day}`);
  }
  return result;
}

function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}
