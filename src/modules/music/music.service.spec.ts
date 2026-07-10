import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";

import { User } from "../../entities";
import { MusicService } from "./music.service";

describe("MusicService", () => {
  let service: MusicService;
  let fetchSpy: jest.SpyInstance;

  const mockUsersRepo = {
    createQueryBuilder: jest.fn(() => ({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    })),
    update: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        REDIS_URL: "",
        SPOTIFY_CLIENT_ID: "test-client-id",
        SPOTIFY_CLIENT_SECRET: "test-client-secret",
      };
      return config[key] ?? "";
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MusicService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
      ],
    }).compile();

    service = module.get<MusicService>(MusicService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  describe("detectLinkType", () => {
    it("detects supported Spotify and Apple Music URL shapes", () => {
      expect(service.detectLinkType("https://open.spotify.com/track/abc123")).toBe("track");
      expect(service.detectLinkType("https://open.spotify.com/album/abc123")).toBe("album");
      expect(service.detectLinkType("https://open.spotify.com/playlist/abc123")).toBe("playlist");
      expect(service.detectLinkType("https://music.apple.com/us/album/name/12345?i=67890")).toBe("track");
      expect(service.detectLinkType("https://music.apple.com/us/album/name/12345")).toBe("album");
      expect(service.detectLinkType("https://itunes.apple.com/us/playlist/chill/pl.pm-123")).toBe("playlist");
    });
  });

  describe("Apple Music extractors", () => {
    it("preserves storefront and embedded song ids", () => {
      expect((service as any).extractAppleMusicStorefront("https://music.apple.com/ng/album/starboy/1440877791?i=1440877793")).toBe("ng");
      expect((service as any).extractAppleMusicAlbumId("https://music.apple.com/us/album/starboy/1440877791")).toBe("1440877791");
      expect((service as any).extractAppleMusicTrackId("https://music.apple.com/us/album/starboy/1440877791?i=1440877793")).toBe("1440877793");
      expect((service as any).extractAppleMusicPlaylistId("https://itunes.apple.com/us/playlist/chill/pl.pm-123456789")).toBe("pl.pm-123456789");
    });
  });

  describe("prepareLink", () => {
    it("resolves Spotify short links and normalizes the final URL", async () => {
      const shortLinkResponse = new Response("OK", { status: 200 });
      Object.defineProperty(shortLinkResponse, "url", {
        configurable: true,
        value: "https://open.spotify.com/track/7MXVkk9YMctZqd1Srtv4MB?si=abc123",
      });
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(shortLinkResponse);

      const prepared = await service.prepareLink("https://spotify.link/example123", "req-short");

      expect(prepared.provider).toBe("spotify");
      expect(prepared.linkType).toBe("track");
      expect(prepared.normalizedUrl).toBe("https://open.spotify.com/track/7MXVkk9YMctZqd1Srtv4MB");
    });

    it("rejects unsupported links with a validation error", async () => {
      await expect(service.prepareLink("https://example.com", "req-invalid")).rejects.toMatchObject({
        code: "UNSUPPORTED_PROVIDER_URL",
        requestId: "req-invalid",
        status: 400,
      });
    });
  });

  describe("resilientFetch", () => {
    it("retries retryable upstream responses and succeeds", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 429 }))
        .mockResolvedValueOnce(new Response("OK", { status: 200 }));

      const response = await (service as any).resilientFetch(
        "https://api.example.com/test",
        {},
        { operation: "spec", provider: "spotify", requestId: "req-1", retries: 1, timeoutMs: 2000 },
      );

      expect(response.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("throws a classified upstream network error after retries are exhausted", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

      await expect(
        (service as any).resilientFetch(
          "https://api.example.com/test",
          {},
          { operation: "spec", provider: "spotify", requestId: "req-net", retries: 1, timeoutMs: 2000 },
        ),
      ).rejects.toMatchObject({
        code: "NETWORK_FAILURE",
        httpStatus: 503,
        retriable: true,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("parseLink", () => {
    it("rejects non-music links", async () => {
      await expect(service.parseLink("https://example.com", "req-invalid-link")).rejects.toMatchObject({
        code: "UNSUPPORTED_PROVIDER_URL",
        requestId: "req-invalid-link",
        status: 400,
      });
    });

    it("classifies provider not found as a 404 music resolution error", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: "sp-token", expires_in: 3600 }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

      await expect(
        service.parseLink("https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6", "req-404"),
      ).rejects.toMatchObject({
        code: "PROVIDER_NOT_FOUND",
        requestId: "req-404",
        status: 404,
      });
    });

    it("classifies transient provider failures as retriable backend errors", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: "sp-token", expires_in: 3600 }),
            { status: 200 },
          ),
        )
        .mockResolvedValue(new Response("Provider unavailable", { status: 503 }));

      await expect(
        service.parseLink("https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6", "req-503"),
      ).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        requestId: "req-503",
        retriable: true,
        status: 503,
      });
    });
  });

  describe("getRecentSongs", () => {
    it("returns an empty array without a user id", async () => {
      await expect(service.getRecentSongs()).resolves.toEqual([]);
    });
  });

  describe("search", () => {
    it("returns an empty array for an empty query", async () => {
      await expect(service.search("")).resolves.toEqual([]);
      await expect(service.search("", "apple-music")).resolves.toEqual([]);
    });
  });
});
