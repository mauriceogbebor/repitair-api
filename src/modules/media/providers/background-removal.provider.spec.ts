import { createBackgroundRemovalProvider, normalizeProviderId, ProviderNotConfiguredError, StubBackgroundRemovalProvider } from "./background-removal.provider";

function config(map: Record<string, string | undefined>) {
  return { get: (key: string) => map[key] } as { get: (k: string) => string | undefined };
}

describe("background removal provider selection (config-driven)", () => {
  it("defaults to the stub outside production", () => {
    const provider = createBackgroundRemovalProvider(config({ NODE_ENV: "development" }));
    expect(provider.name).toBe("stub");
  });

  it("refuses the stub in production", () => {
    expect(() => createBackgroundRemovalProvider(config({ NODE_ENV: "production" }))).toThrow(/not permitted in production/);
  });

  it("selects remove.bg when configured", () => {
    const provider = createBackgroundRemovalProvider(config({ BG_REMOVAL_PROVIDER: "remove_bg", REMOVE_BG_API_KEY: "k" }));
    expect(provider.name).toBe("remove_bg");
  });

  it("accepts the production alias BG_REMOVAL_PROVIDER=removebg (and other spellings)", () => {
    for (const spelling of ["removebg", "remove.bg", "REMOVE-BG", " RemoveBG "]) {
      const provider = createBackgroundRemovalProvider(config({ BG_REMOVAL_PROVIDER: spelling, REMOVE_BG_API_KEY: "k" }));
      expect(provider.name).toBe("remove_bg");
    }
    expect(normalizeProviderId("removebg")).toBe("remove_bg");
  });

  it("fails immediately when removebg is configured without a key", () => {
    expect(() => createBackgroundRemovalProvider(config({ BG_REMOVAL_PROVIDER: "removebg" }))).toThrow(ProviderNotConfiguredError);
  });

  it("throws a clear error when the selected provider lacks credentials", () => {
    expect(() => createBackgroundRemovalProvider(config({ BG_REMOVAL_PROVIDER: "clipdrop" }))).toThrow(ProviderNotConfiguredError);
  });

  it("stub returns the source bytes labelled as PNG (no external call)", async () => {
    const stub = new StubBackgroundRemovalProvider();
    const out = await stub.removeBackground({ buffer: Buffer.from("abc"), mimeType: "image/jpeg" });
    expect(out.mimeType).toBe("image/png");
    expect(out.buffer.toString()).toBe("abc");
  });
});
