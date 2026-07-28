import { BadRequestException } from "@nestjs/common";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ResolvedDateRange {
  /** Inclusive lower bound (>=). */
  start: Date | null;
  /** Exclusive upper bound (<). */
  endExclusive: Date | null;
}

/**
 * Resolve admin list/export date filters into an inclusive lower bound and an
 * EXCLUSIVE upper bound, evaluated in UTC.
 *
 * Timezone contract: date-only inputs (`YYYY-MM-DD`, what the admin date pickers
 * emit) are interpreted as UTC calendar days. A date-only `dateTo` therefore
 * covers the entire selected day because the exclusive bound is the start of the
 * FOLLOWING UTC day. Full ISO timestamps are honoured to the millisecond (the
 * exclusive bound is the instant + 1ms, so `< endExclusive` includes it).
 *
 * Validation: an unparseable value, or a range where `dateFrom` is after
 * `dateTo`, throws a structured 400 (`InvalidDateRange`).
 */
export function resolveDateRange(rawFrom: string | undefined, rawTo: string | undefined, label = "date"): ResolvedDateRange {
  const start = parseStart(rawFrom, label);
  const end = parseEnd(rawTo, label);
  if (start && end.inclusiveInstant && start.getTime() > end.inclusiveInstant.getTime()) {
    throw badRange(label, "dateFrom must be on or before dateTo");
  }
  return { start, endExclusive: end.endExclusive };
}

/**
 * Parse a date-only string with round-trip validation so impossible calendar
 * dates (e.g. 2026-02-31, which the Date constructor silently rolls forward to
 * 3 March) are REJECTED rather than normalized.
 */
function parseDateOnly(raw: string, label: string, field: string): Date {
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw badRange(label, `invalid ${field}`);
  }
  return date;
}

function parseStart(raw: string | undefined, label: string): Date | null {
  if (!raw) return null;
  if (DATE_ONLY.test(raw)) return parseDateOnly(raw, label, "dateFrom");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw badRange(label, "invalid dateFrom");
  return date;
}

function parseEnd(raw: string | undefined, label: string): { endExclusive: Date | null; inclusiveInstant: Date | null } {
  if (!raw) return { endExclusive: null, inclusiveInstant: null };
  if (DATE_ONLY.test(raw)) {
    const day = parseDateOnly(raw, label, "dateTo");
    const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    return { endExclusive: nextDay, inclusiveInstant: new Date(nextDay.getTime() - 1) };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw badRange(label, "invalid dateTo");
  return { endExclusive: new Date(date.getTime() + 1), inclusiveInstant: date };
}

function badRange(label: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: "InvalidDateRange", message: `${label}: ${message}` });
}
