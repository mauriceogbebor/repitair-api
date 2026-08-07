import {
  DEFAULT_MEDIA_PROCESSING_PURPOSE,
  derivativeContentKey,
  normalizeMediaProcessingPurpose,
} from "./media-processing-purpose";

describe("media processing purpose (Ice Girl dual-photo ownership)", () => {
  it("defaults unknown / missing purpose to canvasSubject (backward compatible)", () => {
    expect(normalizeMediaProcessingPurpose(undefined)).toBe("canvasSubject");
    expect(normalizeMediaProcessingPurpose(null)).toBe("canvasSubject");
    expect(normalizeMediaProcessingPurpose("nonsense")).toBe("canvasSubject");
    expect(DEFAULT_MEDIA_PROCESSING_PURPOSE).toBe("canvasSubject");
  });

  it("accepts the two known purposes", () => {
    expect(normalizeMediaProcessingPurpose("canvasSubject")).toBe("canvasSubject");
    expect(normalizeMediaProcessingPurpose("iceGirlWidgetSubject")).toBe("iceGirlWidgetSubject");
  });

  it("canvasSubject yields the LEGACY content key (no regression to existing reuse)", () => {
    const legacy = derivativeContentKey("abc123", "transparent_png", "v2");
    expect(legacy).toBe("abc123:transparent_png:v2");
    expect(derivativeContentKey("abc123", "transparent_png", "v2", "canvasSubject")).toBe(legacy);
  });

  it("same source under a different purpose partitions into an independent key", () => {
    const canvas = derivativeContentKey("abc123", "transparent_png", "v2", "canvasSubject");
    const widget = derivativeContentKey("abc123", "transparent_png", "v2", "iceGirlWidgetSubject");
    expect(widget).not.toBe(canvas);
    expect(widget).toBe("abc123:transparent_png:v2:iceGirlWidgetSubject");
  });
});
