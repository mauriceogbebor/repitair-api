/**
 * Canonical support case status transition table — the BACKEND is authoritative
 * for enforcement and is the single source of truth.
 *
 * A backend unit test (support-lifecycle.constants.spec.ts) asserts the exact
 * contents of this map. repitair-admin/lib/support-lifecycle.ts keeps an
 * identical copy for UI option shaping.
 *
 * Cross-repository drift IS now guarded: support-lifecycle.parity.spec.ts reads
 * the admin mirror and asserts it matches this table exactly, so a change here
 * without the matching admin edit fails the backend suite. Still update the
 * admin mirror (repitair-admin/lib/support-lifecycle.ts) whenever you change a
 * transition; the parity test will confirm the two stay in step.
 */
export const SUPPORT_STATUS_TRANSITIONS: Record<string, string[]> = {
  new: ["open", "assigned", "waiting_for_internal", "escalated"],
  open: ["assigned", "waiting_for_customer", "waiting_for_internal", "escalated"],
  assigned: ["open", "waiting_for_customer", "waiting_for_internal", "escalated"],
  waiting_for_customer: ["open", "assigned", "waiting_for_internal", "escalated"],
  waiting_for_internal: ["open", "assigned", "waiting_for_customer", "escalated"],
  escalated: ["open", "assigned", "waiting_for_internal"],
  reopened: ["open", "assigned", "waiting_for_customer", "waiting_for_internal", "escalated"],
  resolved: ["closed"],
  closed: [],
};

/** Ordinary destination states reachable from the given status. */
export function supportStatusDestinations(status: string): string[] {
  return SUPPORT_STATUS_TRANSITIONS[status] ?? [];
}

/** True when at least one ordinary status transition is available. */
export function canChangeSupportStatus(status: string): boolean {
  return supportStatusDestinations(status).length > 0;
}
