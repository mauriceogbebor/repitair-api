import { BadRequestException } from "@nestjs/common";
import { resolveDateRange } from "./date-range";

describe("resolveDateRange", () => {
  it("treats a date-only dateTo as the whole calendar day (exclusive next-day bound, UTC)", () => {
    const { start, endExclusive } = resolveDateRange("2026-01-01", "2026-01-31", "repit");
    expect(start?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    // Exclusive bound is the start of 1 Feb, so 31 Jan 23:59:59.999 is still included.
    expect(endExclusive?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("includes a record created late on the selected end day", () => {
    const { endExclusive } = resolveDateRange(undefined, "2026-01-31", "repit");
    const lateThatDay = new Date("2026-01-31T23:59:59.500Z");
    expect(lateThatDay.getTime()).toBeLessThan(endExclusive!.getTime());
  });

  it("honours full timestamps to the millisecond via an inclusive-instant exclusive bound", () => {
    const { start, endExclusive } = resolveDateRange("2026-01-01T09:00:00.000Z", "2026-01-01T17:00:00.000Z");
    expect(start?.toISOString()).toBe("2026-01-01T09:00:00.000Z");
    expect(endExclusive?.toISOString()).toBe("2026-01-01T17:00:00.001Z");
  });

  it("returns nulls when no bounds are supplied", () => {
    expect(resolveDateRange(undefined, undefined)).toEqual({ start: null, endExclusive: null });
  });

  it("rejects an inverted range with a structured 400", () => {
    expect(() => resolveDateRange("2026-02-01", "2026-01-01", "report")).toThrow(BadRequestException);
    try {
      resolveDateRange("2026-02-01", "2026-01-01", "report");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({ statusCode: 400, error: "InvalidDateRange" });
    }
  });

  it("allows an equal date-only from/to (same day)", () => {
    expect(() => resolveDateRange("2026-01-15", "2026-01-15")).not.toThrow();
  });

  it("rejects an unparseable value with a structured 400", () => {
    expect(() => resolveDateRange("not-a-date", undefined)).toThrow(BadRequestException);
  });

  it("rejects impossible calendar dates instead of normalizing them", () => {
    // 2026-02-31 would roll forward to 3 March under naive Date parsing.
    expect(() => resolveDateRange("2026-02-31", undefined)).toThrow(BadRequestException);
    expect(() => resolveDateRange(undefined, "2026-13-01")).toThrow(BadRequestException);
    expect(() => resolveDateRange(undefined, "2026-04-31")).toThrow(BadRequestException);
    // A genuine leap day is accepted.
    expect(() => resolveDateRange("2028-02-29", undefined)).not.toThrow();
    // A non-leap-year 29 Feb is rejected.
    expect(() => resolveDateRange("2026-02-29", undefined)).toThrow(BadRequestException);
  });
});
