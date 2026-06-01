// Centralized date helpers in America/Sao_Paulo (GMT-3).
// Use these whenever you need "today" or convert a Date to a YYYY-MM-DD key
// that represents a calendar day in Brazil — avoids the "one day less" bug
// caused by `new Date().toISOString().split("T")[0]` (UTC).

const TZ = "America/Sao_Paulo";

/** Returns the current Date object (unchanged), used for arithmetic. */
export const nowBR = () => new Date();

/**
 * Returns the calendar parts (year, month, day) for a given Date in BR timezone.
 * Avoids depending on the user's local timezone.
 */
export const getBRParts = (d: Date = new Date()) => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

/**
 * Today as YYYY-MM-DD in America/Sao_Paulo.
 * Use this instead of `new Date().toISOString().split("T")[0]`.
 */
export const todayBR = (d: Date = new Date()) => {
  const { year, month, day } = getBRParts(d);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/**
 * Convert a Date (or string) to YYYY-MM-DD in BR timezone.
 */
export const toBRDateKey = (input: Date | string = new Date()) => {
  const d = typeof input === "string" ? new Date(input) : input;
  return todayBR(d);
};

/**
 * Parse a YYYY-MM-DD string into a local Date pinned at noon (timezone-safe).
 * For ISO timestamps, returns a regular Date.
 */
export const parseAppDate = (value?: string | null): Date | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

/** Format a date string/Date as dd/mm/yyyy in BR timezone. */
export const formatBRDate = (value?: string | null | Date): string => {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = parseAppDate(value);
    return d ? d.toLocaleDateString("pt-BR") : "—";
  }
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: TZ });
};

/** Format a timestamp as dd/mm/yyyy HH:mm in BR timezone. */
export const formatBRDateTime = (value?: string | null | Date): string => {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** Format time-only as HH:mm in BR timezone. */
export const formatBRTime = (value?: string | null | Date): string => {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
};
