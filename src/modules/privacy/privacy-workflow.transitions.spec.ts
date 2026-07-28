import { PrivacyWorkflowService } from "./privacy-workflow.service";
import type { PrivacyRequest } from "../../entities/privacy-request.entity";

/**
 * DB-free unit tests for the privacy lifecycle state machine (remediation
 * items 4 & 11). These exercise the pure static methods only — no repository,
 * DataSource, or database is required.
 */
describe("PrivacyWorkflowService state machine", () => {
  describe("canTransition", () => {
    it("permits the documented forward path", () => {
      expect(PrivacyWorkflowService.canTransition("pending", "assigned")).toBe(true);
      expect(PrivacyWorkflowService.canTransition("assigned", "in_review")).toBe(true);
      expect(PrivacyWorkflowService.canTransition("in_review", "approved")).toBe(true);
      expect(PrivacyWorkflowService.canTransition("approved", "processing")).toBe(true);
      expect(PrivacyWorkflowService.canTransition("processing", "fulfilled")).toBe(true);
      expect(PrivacyWorkflowService.canTransition("fulfilled", "completed")).toBe(true);
    });

    it("supports the failed → retry_required → processing recovery loop", () => {
      expect(PrivacyWorkflowService.canTransition("processing", "failed")).toBe(true);
      expect(PrivacyWorkflowService.canTransition("failed", "retry_required")).toBe(true);
      expect(PrivacyWorkflowService.canTransition("retry_required", "processing")).toBe(true);
    });

    it("rejects skipping the approval gate before processing", () => {
      expect(PrivacyWorkflowService.canTransition("assigned", "processing")).toBe(false);
      expect(PrivacyWorkflowService.canTransition("pending", "processing")).toBe(false);
      expect(PrivacyWorkflowService.canTransition("in_review", "processing")).toBe(false);
    });

    it("never allows completion without fulfilment", () => {
      expect(PrivacyWorkflowService.canTransition("approved", "completed")).toBe(false);
      expect(PrivacyWorkflowService.canTransition("processing", "completed")).toBe(false);
    });

    it("treats terminal states as sinks", () => {
      for (const terminal of ["completed", "rejected", "cancelled", "expired"] as const) {
        for (const to of ["assigned", "processing", "pending", "in_review"] as const) {
          expect(PrivacyWorkflowService.canTransition(terminal, to)).toBe(false);
        }
      }
    });

    it("does not permit an unbounded retry loop from a terminal completed state", () => {
      expect(PrivacyWorkflowService.canTransition("completed", "retry_required")).toBe(false);
      expect(PrivacyWorkflowService.canTransition("completed", "processing")).toBe(false);
    });
  });

  describe("isActive", () => {
    it("marks in-flight statuses active and terminal statuses inactive", () => {
      expect(PrivacyWorkflowService.isActive("processing")).toBe(true);
      expect(PrivacyWorkflowService.isActive("retry_required")).toBe(true);
      expect(PrivacyWorkflowService.isActive("completed")).toBe(false);
      expect(PrivacyWorkflowService.isActive("rejected")).toBe(false);
      expect(PrivacyWorkflowService.isActive("cancelled")).toBe(false);
    });
  });

  describe("computeDueAt", () => {
    it("applies the 72h SLA for deletion/export and 168h for access/correction", () => {
      const base = new Date("2026-01-01T00:00:00.000Z");
      expect(PrivacyWorkflowService.computeDueAt("account_deletion", base).toISOString()).toBe("2026-01-04T00:00:00.000Z");
      expect(PrivacyWorkflowService.computeDueAt("data_export", base).toISOString()).toBe("2026-01-04T00:00:00.000Z");
      expect(PrivacyWorkflowService.computeDueAt("data_access", base).toISOString()).toBe("2026-01-08T00:00:00.000Z");
    });
  });

  describe("slaView", () => {
    const make = (over: Partial<PrivacyRequest>): PrivacyRequest => ({
      status: "processing", escalationLevel: 0, priority: "medium", dueAt: null, ...over,
    } as PrivacyRequest);

    it("is overdue only when active and past due", () => {
      const past = new Date(Date.now() - 3600_000);
      expect(PrivacyWorkflowService.slaView(make({ status: "processing", dueAt: past })).overdue).toBe(true);
    });

    it("is not overdue when the request is already terminal even if past due", () => {
      const past = new Date(Date.now() - 3600_000);
      expect(PrivacyWorkflowService.slaView(make({ status: "completed", dueAt: past })).overdue).toBe(false);
    });

    it("is not overdue when due date is in the future", () => {
      const future = new Date(Date.now() + 3600_000);
      expect(PrivacyWorkflowService.slaView(make({ status: "processing", dueAt: future })).overdue).toBe(false);
    });
  });
});
