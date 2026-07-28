import { SUPPORT_STATUS_TRANSITIONS, supportStatusDestinations, canChangeSupportStatus } from "./support-lifecycle.constants";

/**
 * Backend canonical-table guard. This asserts the BACKEND table only — it is the
 * authoritative source. The admin mirror (repitair-admin/lib/support-lifecycle.ts)
 * is kept identical by hand; there is no automated cross-repository check because
 * the admin package has no test runner (tracked as a LOW residual risk).
 */
const CANONICAL: Record<string, string[]> = {
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

describe("support lifecycle transitions", () => {
  it("matches the canonical parity table", () => {
    expect(SUPPORT_STATUS_TRANSITIONS).toEqual(CANONICAL);
  });

  it("never lists the current state as a destination", () => {
    for (const [status, destinations] of Object.entries(SUPPORT_STATUS_TRANSITIONS)) {
      expect(destinations).not.toContain(status);
    }
  });

  it("offers only closed from resolved and nothing from closed", () => {
    expect(supportStatusDestinations("resolved")).toEqual(["closed"]);
    expect(canChangeSupportStatus("resolved")).toBe(true);
    expect(supportStatusDestinations("closed")).toEqual([]);
    expect(canChangeSupportStatus("closed")).toBe(false);
  });
});
