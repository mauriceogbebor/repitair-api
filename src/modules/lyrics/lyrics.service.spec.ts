import { ConfigService } from "@nestjs/config";

import { PlatformService } from "../platform/platform.service";
import { LyricsService } from "./lyrics.service";

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function makePlatform(flagEnabled = true): PlatformService {
  return { isEnabled: jest.fn(async () => flagEnabled) } as unknown as PlatformService;
}

function makeService(env: Record<string, string | undefined> = {}, flagEnabled = true): LyricsService {
  return new LyricsService(makeConfig(env), makePlatform(flagEnabled));
}

describe("LyricsService", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("isEnabled (two-layer kill switch)", () => {
    it("defers to the admin flag when the env override is unset", async () => {
      expect(await makeService({}, true).isEnabled()).toBe(true);
      expect(await makeService({}, false).isEnabled()).toBe(false);
    });

    it("env LYRICS_ENABLED=false hard-disables regardless of the admin flag", async () => {
      expect(await makeService({ LYRICS_ENABLED: "  FALSE " }, true).isEnabled()).toBe(false);
      expect(await makeService({ LYRICS_ENABLED: "false" }, true).isEnabled()).toBe(false);
    });

    it("any non-false env value leaves the decision to the admin flag", async () => {
      expect(await makeService({ LYRICS_ENABLED: "true" }, true).isEnabled()).toBe(true);
      expect(await makeService({ LYRICS_ENABLED: "anything" }, false).isEnabled()).toBe(false);
    });
  });

  describe("search", () => {
    it("returns null and never calls upstream when disabled", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = makeService({ LYRICS_ENABLED: "false" }, true);

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
      const service = makeService({ LYRICS_ENABLED: "true" }, true);

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
      const service = makeService({}, true);
      expect(await service.search("Song", "Artist")).toBeNull();
    });

    it("returns null (never throws) when upstream fails", async () => {
      global.fetch = (jest.fn(async () => {
        throw new Error("network down");
      }) as unknown) as typeof fetch;
      const service = makeService({}, true);
      expect(await service.search("Song", "Artist")).toBeNull();
    });
  });
});
