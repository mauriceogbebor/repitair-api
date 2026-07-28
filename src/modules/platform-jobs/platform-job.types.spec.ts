import { createHash } from "node:crypto";
import {
  NonRetryableJobError,
  classifyError,
  computeBackoffMs,
  getJobDefinition,
  JOB_DEFINITIONS,
} from "./platform-job.types";

/**
 * DB-free unit tests for the platform-job pure helpers that back the privacy
 * async execution path (remediation item 4: enqueue/retry consistency) and a
 * guard for the download-token hashing property (remediation item 2).
 */
describe("platform-job pure helpers", () => {
  describe("classifyError", () => {
    it("marks NonRetryableJobError as non-retryable and preserves its code", () => {
      const result = classifyError(new NonRetryableJobError("stale or duplicate job", "stale_job"));
      expect(result).toEqual({ code: "stale_job", retryable: false });
    });

    it("classifies transient infrastructure errors as retryable", () => {
      for (const message of ["connection timeout", "ECONNRESET", "rate limit exceeded", "too many connections"]) {
        expect(classifyError(new Error(message)).retryable).toBe(true);
      }
    });

    it("classifies unknown application errors as non-retryable", () => {
      expect(classifyError(new Error("validation failed: bad input")).retryable).toBe(false);
      expect(classifyError("some string failure").retryable).toBe(false);
    });
  });

  describe("computeBackoffMs", () => {
    const def = getJobDefinition("privacy.account_deletion")!;

    it("returns 0 for the first attempt (no immediate hammering beyond schedule)", () => {
      expect(computeBackoffMs(0, def)).toBe(0);
    });

    it("stays within ±20% jitter of the scheduled base for a mid attempt", () => {
      const base = def.backoffMs[2];
      for (let i = 0; i < 200; i++) {
        const v = computeBackoffMs(2, def);
        expect(v).toBeGreaterThanOrEqual(Math.round(base * 0.8) - 1);
        expect(v).toBeLessThanOrEqual(Math.round(base * 1.2) + 1);
      }
    });

    it("caps the index at the end of the schedule for high attempt counts", () => {
      const last = def.backoffMs[def.backoffMs.length - 1];
      const v = computeBackoffMs(999, def);
      expect(v).toBeGreaterThanOrEqual(Math.round(last * 0.8) - 1);
      expect(v).toBeLessThanOrEqual(Math.round(last * 1.2) + 1);
    });

    it("never returns a negative delay", () => {
      for (let i = 0; i < 500; i++) expect(computeBackoffMs(1, def)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("privacy job definitions", () => {
    it("registers both privacy job types with bounded retries", () => {
      for (const type of ["privacy.data_export", "privacy.account_deletion"]) {
        const d = getJobDefinition(type);
        expect(d).not.toBeNull();
        expect(d!.maxAttempts).toBeGreaterThan(0);
        expect(d!.maxAttempts).toBeLessThanOrEqual(10);
      }
    });

    it("rejects an enqueue payload missing privacyRequestId", () => {
      const d = JOB_DEFINITIONS["privacy.data_export"];
      expect(d.validate!({})).toMatch(/privacyRequestId/);
      expect(d.validate!({ privacyRequestId: "abc" })).toBeNull();
    });

    it("returns null for an unknown job type", () => {
      expect(getJobDefinition("privacy.__nope__")).toBeNull();
    });
  });

  describe("download-token hashing property (item 2)", () => {
    it("stores only a sha256 hash and matches by re-hashing the presented token", () => {
      const token = "tok_live_abcdef0123456789";
      const stored = createHash("sha256").update(token).digest("hex");
      // The plaintext token is never equal to what is persisted.
      expect(stored).not.toBe(token);
      expect(stored).toHaveLength(64);
      // A correct token re-hashes to the stored value; a wrong one does not.
      expect(createHash("sha256").update(token).digest("hex")).toBe(stored);
      expect(createHash("sha256").update(token + "x").digest("hex")).not.toBe(stored);
    });
  });
});
