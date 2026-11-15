import { ConfigService } from "@nestjs/config";

import { LyricsService } from "./lyrics.service";

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe("LyricsService", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("isEnabled (kill switch)", () => {
    it("defaults to enabled when LYRICS_ENABLED is unset", () => {
      expect(new LyricsService(makeConfig({})).isEnabled()).toBe(true);
    });

    it("stays enabled unless explicitly 'false' (case/space tolerant)", () => {
      expect(new LyricsService(makeConfig({ LYRICS_ENABLED: "true" })).isEnabled()).toBe(true);
      expect(new LyricsService(makeConfig({ LYRICS_ENABLED: "anything" })).isEnabled()).toBe(true);
      expect(new LyricsService(makeConfig({ LYRICS_ENABLED: "  FALSE " })).isEnabled()).toBe(false);
      expect(new LyricsService(makeConfig({ LYRICS_ENABLED: "false" })).isEnabled()).toBe(false);
    });
  });

  describe("search", () => {
    it("returns null and never calls upstream when disabled", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new LyricsService(makeConfig({ LYRICS_ENABLED: "false" }));

      const result = await service.search("Song", "Artist");

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps the best non-instrumental match with plain lyrics into lines", async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        json: async () => [
          { trackName: "Skip", artistName: "A", albumName: null, plainLyrics: null, instrumental: true },
          { trackName: "Song", artistName: "Artist", albumName: "Album", plainLyrics: "One\n\nTwo  ", instrumental: false },
        ],
      }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new LyricsService(makeConfig({ LYRICS_ENABLED: "true" }));

      const result = await service.search("Song", "Artist");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        trackName: "Song",
        artistName: "Artist",
        albumName: "Album",
        plainLyrics: "One\n\nTwo  ",
        lines: ["One", "Two"],
      });
    });

    it("returns null on a non-ok upstream response", async () => {
      global.fetch = (jest.fn(async () => ({ ok: false, json: async () => [] })) as unknown) as typeof fetch;
      const service = new LyricsService(makeConfig({}));
      expect(await service.search("Song", "Artist")).toBeNull();
    });

    it("returns null (never throws) when upstream fails", async () => {
      global.fetch = (jest.fn(async () => {
        throw new Error("network down");
      }) as unknown) as typeof fetch;
      const service = new LyricsService(makeConfig({}));
      expect(await service.search("Song", "Artist")).toBeNull();
    });
  });
});
