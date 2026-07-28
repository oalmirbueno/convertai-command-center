import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export const EDITORIAL_DEFAULT_TIME_ZONE = "America/Sao_Paulo";

export type EditorialCalendarView = "month" | "week" | "list";
export type EditorialCalendarNavigation = "previous" | "next" | "today";

export interface EditorialCalendarDay {
  dateKey: string;
  dayOfMonth: number;
  weekdayIndex: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

export interface EditorialQueryRange {
  startDate: string;
  endDateExclusive: string;
  startIso: string;
  endExclusiveIso: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

interface DateTimeParts extends DateParts {
  hour: number;
  minute: number;
  second: number;
}

const WEEK_OPTIONS = { weekStartsOn: 1 as const };
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const ISO_WITH_OFFSET_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;
const OFFSET_SAMPLE_HOURS = [-48, -36, -24, -12, 0, 12, 24, 36, 48];

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

function parseDateKey(value: unknown): DateParts | null {
  if (typeof value !== "string") return null;
  const match = DATE_KEY_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return null;
  }

  return { year, month, day };
}

function parseLocalDateTime(value: unknown): DateTimeParts | null {
  if (typeof value !== "string") return null;
  const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) return null;

  const date = parseDateKey(`${match[1]}-${match[2]}-${match[3]}`);
  if (!date) return null;

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  return { ...date, hour, minute, second };
}

function toCivilDate(value: string): Date | null {
  const parts = parseDateKey(value);
  if (!parts) return null;

  // Noon avoids accidental date shifts around local midnight while date-fns
  // performs calendar-only arithmetic. setFullYear also avoids Date's special
  // constructor treatment that maps years 0..99 to 1900..1999.
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}

function toDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function createZonedFormatter(timeZone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
}

function partsFromFormatter(
  instant: Date,
  formatter: Intl.DateTimeFormat,
): DateTimeParts | null {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  const result = {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };

  return Object.values(result).every(Number.isFinite) ? result : null;
}

function partsEqual(left: DateTimeParts, right: DateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function utcEpochFromParts(parts: DateTimeParts): number {
  const date = new Date(0);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date.getTime();
}

function offsetAt(
  epochMs: number,
  formatter: Intl.DateTimeFormat,
): number | null {
  const parts = partsFromFormatter(new Date(epochMs), formatter);
  if (!parts) return null;

  // Ignore milliseconds because Intl formatting above has second precision.
  const instantAtSecondPrecision = Math.trunc(epochMs / 1000) * 1000;
  return utcEpochFromParts(parts) - instantAtSecondPrecision;
}

export function isEditorialDateKey(value: unknown): value is string {
  return parseDateKey(value) !== null;
}

/**
 * Normalizes a route/search `date` parameter. Invalid input falls back to a
 * caller-provided, already deterministic calendar date.
 */
export function normalizeEditorialDateParam(
  value: unknown,
  fallbackDate: string,
): string {
  const fallback = typeof fallbackDate === "string" ? fallbackDate.trim() : "";
  if (!isEditorialDateKey(fallback)) {
    throw new RangeError("fallbackDate must be a valid YYYY-MM-DD date");
  }

  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return isEditorialDateKey(normalized) ? normalized : fallback;
}

/**
 * Returns the calendar date of an instant in an IANA timezone.
 */
export function dateKeyInTimeZone(
  instant: Date | string,
  timeZone = EDITORIAL_DEFAULT_TIME_ZONE,
): string | null {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;

  const formatter = createZonedFormatter(timeZone);
  if (!formatter) return null;
  const parts = partsFromFormatter(date, formatter);
  if (!parts) return null;

  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0",
  )}-${String(parts.day).padStart(2, "0")}`;
}

/**
 * Produces an inclusive start and exclusive end for Supabase range queries.
 * Month includes the outside days rendered by a Monday-first calendar grid;
 * list covers the civil month; week covers Monday through next Monday.
 */
export function getEditorialQueryRange(
  anchorDate: string,
  view: EditorialCalendarView,
  timeZone = EDITORIAL_DEFAULT_TIME_ZONE,
): EditorialQueryRange | null {
  const anchor = toCivilDate(anchorDate);
  if (!anchor || !["month", "week", "list"].includes(view)) return null;

  let start: Date;
  let endExclusive: Date;

  if (view === "week") {
    start = startOfWeek(anchor, WEEK_OPTIONS);
    endExclusive = addWeeks(start, 1);
  } else if (view === "month") {
    start = startOfWeek(startOfMonth(anchor), WEEK_OPTIONS);
    endExclusive = addDays(
      endOfWeek(endOfMonth(anchor), WEEK_OPTIONS),
      1,
    );
  } else {
    start = startOfMonth(anchor);
    endExclusive = addMonths(start, 1);
  }

  const startDate = toDateKey(start);
  const endDateExclusive = toDateKey(endExclusive);
  const startIso = zonedDateTimeLocalToIso(
    `${startDate}T00:00`,
    timeZone,
  );
  const endExclusiveIso = zonedDateTimeLocalToIso(
    `${endDateExclusive}T00:00`,
    timeZone,
  );

  if (!startIso || !endExclusiveIso) return null;
  return { startDate, endDateExclusive, startIso, endExclusiveIso };
}

/**
 * Navigates a view without reading the system clock. The caller supplies
 * `now`, which keeps the helper deterministic and straightforward to test.
 */
export function navigateEditorialDate(
  anchorDate: string,
  view: EditorialCalendarView,
  action: EditorialCalendarNavigation,
  now: Date,
  timeZone = EDITORIAL_DEFAULT_TIME_ZONE,
): string | null {
  if (action === "today") return dateKeyInTimeZone(now, timeZone);

  const anchor = toCivilDate(anchorDate);
  if (!anchor || !["month", "week", "list"].includes(view)) return null;

  const direction = action === "previous" ? -1 : action === "next" ? 1 : 0;
  if (direction === 0) return null;

  return toDateKey(
    view === "week"
      ? addWeeks(anchor, direction)
      : addMonths(anchor, direction),
  );
}

function makeCalendarDay(
  date: Date,
  anchorMonth: number,
  todayDate?: string,
): EditorialCalendarDay {
  return {
    dateKey: toDateKey(date),
    dayOfMonth: date.getDate(),
    // Monday = 0, Sunday = 6.
    weekdayIndex: (date.getDay() + 6) % 7,
    inCurrentMonth: date.getMonth() === anchorMonth,
    isToday: todayDate === toDateKey(date),
  };
}

export function getEditorialMonthCells(
  anchorDate: string,
  todayDate?: string,
): EditorialCalendarDay[] {
  const anchor = toCivilDate(anchorDate);
  if (!anchor) return [];

  const start = startOfWeek(startOfMonth(anchor), WEEK_OPTIONS);
  const end = endOfWeek(endOfMonth(anchor), WEEK_OPTIONS);
  return eachDayOfInterval({ start, end }).map((date) =>
    makeCalendarDay(date, anchor.getMonth(), todayDate),
  );
}

export function getEditorialWeekDays(
  anchorDate: string,
  todayDate?: string,
): EditorialCalendarDay[] {
  const anchor = toCivilDate(anchorDate);
  if (!anchor) return [];

  const start = startOfWeek(anchor, WEEK_OPTIONS);
  return eachDayOfInterval({ start, end: addDays(start, 6) }).map((date) =>
    makeCalendarDay(date, anchor.getMonth(), todayDate),
  );
}

export function getEditorialListDays(
  anchorDate: string,
  todayDate?: string,
): EditorialCalendarDay[] {
  const anchor = toCivilDate(anchorDate);
  if (!anchor) return [];

  return eachDayOfInterval({
    start: startOfMonth(anchor),
    end: endOfMonth(anchor),
  }).map((date) => makeCalendarDay(date, anchor.getMonth(), todayDate));
}

/**
 * Formats an absolute ISO timestamp for an HTML `datetime-local` input.
 * Minute precision matches the default step used by that input type.
 */
export function isoUtcToZonedDateTimeLocal(
  isoTimestamp: string,
  timeZone = EDITORIAL_DEFAULT_TIME_ZONE,
): string | null {
  if (
    typeof isoTimestamp !== "string" ||
    !ISO_WITH_OFFSET_PATTERN.test(isoTimestamp.trim())
  ) {
    return null;
  }

  const instant = new Date(isoTimestamp);
  if (Number.isNaN(instant.getTime())) return null;

  const formatter = createZonedFormatter(timeZone);
  if (!formatter) return null;
  const parts = partsFromFormatter(instant, formatter);
  if (!parts) return null;

  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0",
  )}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(
    2,
    "0",
  )}:${String(parts.minute).padStart(2, "0")}`;
}

/**
 * Converts a civil datetime in an IANA timezone to an absolute UTC ISO value.
 * If a DST transition makes the time nonexistent, null is returned. If the
 * time is ambiguous, the earlier matching instant is chosen deterministically.
 */
export function zonedDateTimeLocalToIso(
  localDateTime: string,
  timeZone = EDITORIAL_DEFAULT_TIME_ZONE,
): string | null {
  const target = parseLocalDateTime(localDateTime);
  if (!target) return null;

  const formatter = createZonedFormatter(timeZone);
  if (!formatter) return null;

  const wallClockEpoch = utcEpochFromParts(target);
  const offsets = new Set<number>();

  for (const hours of OFFSET_SAMPLE_HOURS) {
    const offset = offsetAt(
      wallClockEpoch + hours * 60 * 60 * 1000,
      formatter,
    );
    if (offset !== null) offsets.add(offset);
  }

  const matches: number[] = [];
  for (const offset of offsets) {
    const candidate = wallClockEpoch - offset;
    const candidateParts = partsFromFormatter(new Date(candidate), formatter);
    if (candidateParts && partsEqual(candidateParts, target)) {
      matches.push(candidate);
    }
  }

  if (matches.length === 0) return null;
  return new Date(Math.min(...matches)).toISOString();
}
