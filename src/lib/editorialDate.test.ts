import { describe, expect, it } from "vitest";
import {
  dateKeyInTimeZone,
  getEditorialListDays,
  getEditorialMonthCells,
  getEditorialQueryRange,
  getEditorialWeekDays,
  isoUtcToZonedDateTimeLocal,
  isEditorialDateKey,
  navigateEditorialDate,
  normalizeEditorialDateParam,
  zonedDateTimeLocalToIso,
} from "./editorialDate";

describe("editorial date parameter", () => {
  it("accepts strict calendar dates and rejects impossible ones", () => {
    expect(isEditorialDateKey("2024-02-29")).toBe(true);
    expect(isEditorialDateKey("2026-02-29")).toBe(false);
    expect(isEditorialDateKey("2026-13-01")).toBe(false);
    expect(isEditorialDateKey("28/07/2026")).toBe(false);
  });

  it("normalizes whitespace and falls back for invalid input", () => {
    expect(normalizeEditorialDateParam(" 2026-07-28 ", "2026-07-01")).toBe(
      "2026-07-28",
    );
    expect(normalizeEditorialDateParam("not-a-date", "2026-07-01")).toBe(
      "2026-07-01",
    );
    expect(normalizeEditorialDateParam(null, "2026-07-01")).toBe("2026-07-01");
  });

  it("rejects an invalid fallback instead of hiding a programming error", () => {
    expect(() =>
      normalizeEditorialDateParam("2026-07-28", "2026-02-29"),
    ).toThrow(RangeError);
  });
});

describe("editorial query ranges", () => {
  it("builds a Monday-first month range including outside grid days", () => {
    expect(getEditorialQueryRange("2026-07-15", "month")).toEqual({
      startDate: "2026-06-29",
      endDateExclusive: "2026-08-03",
      startIso: "2026-06-29T03:00:00.000Z",
      endExclusiveIso: "2026-08-03T03:00:00.000Z",
    });
  });

  it("builds a Monday-through-next-Monday week range", () => {
    expect(getEditorialQueryRange("2026-07-28", "week")).toEqual({
      startDate: "2026-07-27",
      endDateExclusive: "2026-08-03",
      startIso: "2026-07-27T03:00:00.000Z",
      endExclusiveIso: "2026-08-03T03:00:00.000Z",
    });
  });

  it("uses the civil month for list queries", () => {
    expect(getEditorialQueryRange("2026-07-28", "list")).toEqual({
      startDate: "2026-07-01",
      endDateExclusive: "2026-08-01",
      startIso: "2026-07-01T03:00:00.000Z",
      endExclusiveIso: "2026-08-01T03:00:00.000Z",
    });
  });

  it("fails closed for invalid anchors or timezones", () => {
    expect(getEditorialQueryRange("2026-02-29", "month")).toBeNull();
    expect(
      getEditorialQueryRange("2026-07-28", "month", "Invalid/Timezone"),
    ).toBeNull();
  });
});

describe("editorial navigation and generated days", () => {
  const now = new Date("2026-07-29T01:30:00.000Z");

  it("navigates by each view period and resolves today in the target timezone", () => {
    expect(
      navigateEditorialDate("2026-07-28", "month", "previous", now),
    ).toBe("2026-06-28");
    expect(navigateEditorialDate("2026-07-28", "month", "next", now)).toBe(
      "2026-08-28",
    );
    expect(navigateEditorialDate("2026-07-28", "week", "previous", now)).toBe(
      "2026-07-21",
    );
    expect(navigateEditorialDate("2026-07-28", "week", "next", now)).toBe(
      "2026-08-04",
    );
    expect(navigateEditorialDate("2026-07-28", "list", "next", now)).toBe(
      "2026-08-28",
    );
    expect(navigateEditorialDate("2026-01-01", "month", "today", now)).toBe(
      "2026-07-28",
    );
  });

  it("returns null for invalid navigation input", () => {
    expect(
      navigateEditorialDate("invalid", "month", "next", now),
    ).toBeNull();
    expect(
      navigateEditorialDate(
        "2026-07-28",
        "month",
        "today",
        now,
        "Invalid/Timezone",
      ),
    ).toBeNull();
  });

  it("generates a complete Monday-first month grid", () => {
    const cells = getEditorialMonthCells("2026-07-15", "2026-07-28");
    expect(cells).toHaveLength(35);
    expect(cells[0]).toMatchObject({
      dateKey: "2026-06-29",
      weekdayIndex: 0,
      inCurrentMonth: false,
    });
    expect(cells[cells.length - 1]).toMatchObject({
      dateKey: "2026-08-02",
      weekdayIndex: 6,
      inCurrentMonth: false,
    });
    expect(cells.find((cell) => cell.dateKey === "2026-07-28")?.isToday).toBe(
      true,
    );
  });

  it("generates six weeks when the month boundaries require them", () => {
    const cells = getEditorialMonthCells("2026-08-10");
    expect(cells).toHaveLength(42);
    expect(cells[0].dateKey).toBe("2026-07-27");
    expect(cells[cells.length - 1]?.dateKey).toBe("2026-09-06");
  });

  it("generates Monday-first week and full list-month days", () => {
    const week = getEditorialWeekDays("2026-07-28");
    expect(week.map((day) => day.dateKey)).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);

    const leapMonth = getEditorialListDays("2024-02-10");
    expect(leapMonth).toHaveLength(29);
    expect(leapMonth[0].dateKey).toBe("2024-02-01");
    expect(leapMonth[leapMonth.length - 1]?.dateKey).toBe("2024-02-29");
  });

  it("returns empty cells for an invalid anchor", () => {
    expect(getEditorialMonthCells("2026-02-29")).toEqual([]);
    expect(getEditorialWeekDays("invalid")).toEqual([]);
    expect(getEditorialListDays("2026-00-01")).toEqual([]);
  });
});

describe("IANA timezone conversion", () => {
  it("gets a date key without leaking the runtime timezone", () => {
    expect(
      dateKeyInTimeZone(
        "2026-07-29T01:30:00.000Z",
        "America/Sao_Paulo",
      ),
    ).toBe("2026-07-28");
  });

  it("formats UTC ISO for a datetime-local input in Sao Paulo", () => {
    expect(
      isoUtcToZonedDateTimeLocal(
        "2026-07-28T12:30:45.000Z",
        "America/Sao_Paulo",
      ),
    ).toBe("2026-07-28T09:30");
  });

  it("converts Sao Paulo civil time to UTC with the correct offset", () => {
    expect(
      zonedDateTimeLocalToIso(
        "2026-07-28T09:30",
        "America/Sao_Paulo",
      ),
    ).toBe("2026-07-28T12:30:00.000Z");
  });

  it("supports explicit seconds in datetime-local input", () => {
    expect(
      zonedDateTimeLocalToIso(
        "2026-07-28T09:30:45",
        "America/Sao_Paulo",
      ),
    ).toBe("2026-07-28T12:30:45.000Z");
  });

  it("rejects malformed timestamps, impossible times and invalid timezones", () => {
    expect(
      isoUtcToZonedDateTimeLocal(
        "2026-07-28T12:30:00",
        "America/Sao_Paulo",
      ),
    ).toBeNull();
    expect(
      isoUtcToZonedDateTimeLocal("not-an-iso", "America/Sao_Paulo"),
    ).toBeNull();
    expect(
      zonedDateTimeLocalToIso(
        "2026-02-29T09:30",
        "America/Sao_Paulo",
      ),
    ).toBeNull();
    expect(
      zonedDateTimeLocalToIso(
        "2026-07-28T25:00",
        "America/Sao_Paulo",
      ),
    ).toBeNull();
    expect(
      zonedDateTimeLocalToIso("2026-07-28T09:30", "Invalid/Timezone"),
    ).toBeNull();
  });

  it("rejects nonexistent DST times and resolves ambiguous ones deterministically", () => {
    expect(
      zonedDateTimeLocalToIso(
        "2026-03-08T02:30",
        "America/New_York",
      ),
    ).toBeNull();
    expect(
      zonedDateTimeLocalToIso(
        "2026-11-01T01:30",
        "America/New_York",
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
  });
});
