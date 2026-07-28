import { costPerImage, roundCurrency } from "./media-cost";

describe("media cost intelligence", () => {
  afterEach(() => {
    delete process.env.MEDIA_COST_PER_IMAGE;
    delete process.env.MEDIA_COST_PER_IMAGE_REMOVE_BG;
  });

  it("uses the built-in default for a known provider", () => {
    expect(costPerImage("remove_bg")).toBeGreaterThan(0);
    expect(costPerImage("stub")).toBe(0);
  });

  it("prefers a provider-specific env override", () => {
    process.env.MEDIA_COST_PER_IMAGE_REMOVE_BG = "0.15";
    expect(costPerImage("remove_bg")).toBe(0.15);
  });

  it("falls back to a generic env override", () => {
    process.env.MEDIA_COST_PER_IMAGE = "0.05";
    expect(costPerImage("clipdrop")).toBe(0.05);
  });

  it("rounds currency to cents", () => {
    expect(roundCurrency(0.2 * 7)).toBe(1.4);
    expect(roundCurrency(0.1234)).toBe(0.12);
  });
});
