import {
  isolationCapabilityError,
  templateRequiresBackgroundRemoval,
  templateSupportsIsolatedSubject,
} from "./template-media-capability";

describe("template media capability guardrail", () => {
  it("reads requiresBackgroundRemoval / supportsIsolatedSubject", () => {
    expect(templateRequiresBackgroundRemoval({ requiresBackgroundRemoval: true })).toBe(true);
    expect(templateRequiresBackgroundRemoval(null)).toBe(false);
    expect(templateSupportsIsolatedSubject({ supportsIsolatedSubject: true })).toBe(true);
    expect(templateSupportsIsolatedSubject({})).toBe(false);
  });

  it("allows a standard template (neither flag)", () => {
    expect(isolationCapabilityError({})).toBeNull();
    expect(isolationCapabilityError(null)).toBeNull();
    expect(isolationCapabilityError({ requiresBackgroundRemoval: false })).toBeNull();
  });

  it("BLOCKS requiresBackgroundRemoval without supportsIsolatedSubject", () => {
    expect(isolationCapabilityError({ requiresBackgroundRemoval: true })).toMatch(/supportsIsolatedSubject/);
    expect(isolationCapabilityError({ requiresBackgroundRemoval: true, supportsIsolatedSubject: false })).toMatch(/supportsIsolatedSubject/);
  });

  it("allows requiresBackgroundRemoval when the composition supports an isolated subject", () => {
    expect(isolationCapabilityError({ requiresBackgroundRemoval: true, supportsIsolatedSubject: true })).toBeNull();
  });

  it("allows declaring subject support without requiring removal (composition-ready, flag off)", () => {
    expect(isolationCapabilityError({ supportsIsolatedSubject: true })).toBeNull();
  });
});
