import { canTransitionMedia, isReprocessable } from "./media-lifecycle";

describe("media processing lifecycle", () => {
  it("permits the happy path", () => {
    expect(canTransitionMedia("uploaded", "queued")).toBe(true);
    expect(canTransitionMedia("queued", "processing")).toBe(true);
    expect(canTransitionMedia("processing", "completed")).toBe(true);
  });

  it("supports the failure + retry loop", () => {
    expect(canTransitionMedia("processing", "failed")).toBe(true);
    expect(canTransitionMedia("failed", "retry_required")).toBe(true);
    expect(canTransitionMedia("retry_required", "queued")).toBe(true);
  });

  it("treats completed and cancelled as terminal", () => {
    for (const to of ["queued", "processing", "failed"] as const) {
      expect(canTransitionMedia("completed", to)).toBe(false);
      expect(canTransitionMedia("cancelled", to)).toBe(false);
    }
  });

  it("never skips queue/processing straight to completed", () => {
    expect(canTransitionMedia("uploaded", "completed")).toBe(false);
    expect(canTransitionMedia("queued", "completed")).toBe(false);
  });

  it("marks reprocessable states", () => {
    expect(isReprocessable("uploaded")).toBe(true);
    expect(isReprocessable("failed")).toBe(true);
    expect(isReprocessable("retry_required")).toBe(true);
    expect(isReprocessable("processing")).toBe(false);
    expect(isReprocessable("completed")).toBe(false);
  });
});
