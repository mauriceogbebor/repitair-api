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
    service.onModuleDestroy();
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

  describe("prepareLink host hardening + normalization", () => {
    it("accepts canonical Spotify + Apple hosts and normalizes away ?si= and query params", async () => {
      const spotify = await service.prepareLink("https://open.spotify.com/playlist/abc123?si=deadbeef&utm=x", "req");
      expect(spotify.provider).toBe("spotify");
      expect(spotify.linkType).toBe("playlist");
      expect(spotify.normalizedUrl).toBe("https://open.spotify.com/playlist/abc123"); // no ?si=

      const apple = await service.prepareLink("https://music.apple.com/us/playlist/chill/pl.pm-123", "req");
      expect(apple.provider).toBe("apple-music");
      expect(apple.linkType).toBe("playlist");
      expect(apple.storefront).toBe("us");
    });

    it("rejects look-alike hosts that a bare endsWith() would have accepted", async () => {
      for (const bad of [
        "https://xspotify.com/playlist/abc123",
        "https://evil-spotify.com/playlist/abc123",
        "https://notmusic.apple.com/us/playlist/x/pl.1",
        "https://spotify.com.evil.example/playlist/abc123",
        "https://example.com/playlist/abc123",
      ]) {
        await expect(service.prepareLink(bad, "req")).rejects.toMatchObject({
          code: expect.stringMatching(/UNSUPPORTED_PROVIDER_URL|INVALID_LINK/),
        });
      }
    });

    it("still accepts a real Spotify subdomain", async () => {
      const r = await service.prepareLink("https://open.spotify.com/track/xyz789", "req");
      expect(r.provider).toBe("spotify");
      expect(r.linkType).toBe("track");
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

  /* ================================================================
   * PART 1 — MUSIC PIPELINE VERIFICATION
   * Exercise every lifecycle and reliability code path.
   * ================================================================ */

  describe("startup token prewarming", () => {
    it("pre-warms the Spotify token on module init and caches it", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "sp-warm-token", expires_in: 3600 }), { status: 200 }),
      );

      await service.onModuleInit();

      // Cached — no additional fetch.
      const token = await (service as any).getSpotifyAccessToken();
      expect(token).toBe("sp-warm-token");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("does not crash on init when Spotify credentials are missing", async () => {
      const noCredsConfig = { get: jest.fn(() => "") };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MusicService,
          { provide: ConfigService, useValue: noCredsConfig },
          { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        ],
      }).compile();
      const svc = module.get<MusicService>(MusicService);
      await expect(svc.onModuleInit()).resolves.not.toThrow();
      svc.onModuleDestroy();
    });

    it("does not crash on init when Spotify token fetch fails", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("network down"));
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe("refresh timer scheduling", () => {
    it("schedules a refresh timer after successful pre-warm", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ access_token: "sp-token", expires_in: 3600 }), { status: 200 }),
      );

      await service.onModuleInit();
      expect((service as any).spotifyRefreshTimer).not.toBeNull();
    });

    it("does not schedule a refresh timer when token is null", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401 }),
      );

      await service.onModuleInit();
      expect((service as any).spotifyRefreshTimer).toBeNull();
    });

    it("refresh timer invalidates the old token and acquires a new one", async () => {
      jest.useFakeTimers();
      try {
        // Initial pre-warm with short expiry.
        fetchSpy = jest.spyOn(globalThis, "fetch")
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ access_token: "initial-token", expires_in: 60 }), { status: 200 }),
          )
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ access_token: "refreshed-token", expires_in: 3600 }), { status: 200 }),
          );

        await service.onModuleInit();
        expect((service as any).spotifyAccessToken).toBe("initial-token");

        // Advance past the refresh window — timer fires.
        jest.advanceTimersByTime(35_000);

        // Let the async timer callback resolve.
        await Promise.resolve();
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(0);

        expect((service as any).spotifyAccessToken).toBe("refreshed-token");
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("expired token path", () => {
    it("re-fetches when the cached token has expired", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "first", expires_in: 3600 }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "second", expires_in: 3600 }), { status: 200 }),
        );

      // Get initial token.
      const t1 = await (service as any).getSpotifyAccessToken();
      expect(t1).toBe("first");

      // Manually expire it.
      (service as any).spotifyTokenExpiry = Date.now() - 1;

      // Should fetch a new token.
      const t2 = await (service as any).getSpotifyAccessToken();
      expect(t2).toBe("second");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalid token path (401 recovery)", () => {
    const makeContext = () => ({
      requestId: "req-401",
      endpoint: "/music/parse-link",
      provider: "spotify" as const,
      linkType: "track" as const,
      normalizedUrl: "https://open.spotify.com/track/abc123",
      rawUrl: "https://open.spotify.com/track/abc123",
      storefront: null,
    });

    it("spotifyApiCall retries once with a fresh token on 401", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "expired", expires_in: 3600 }), { status: 200 }))
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ name: "Track" }), { status: 200 }));

      const response = await (service as any).spotifyApiCall(
        "https://api.spotify.com/v1/tracks/abc123", makeContext(), "test",
      );
      expect(response.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it("spotifyApiCall returns 401 response when re-auth also fails", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "expired", expires_in: 3600 }), { status: 200 }))
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(new Response("Still Unauthorized", { status: 401 }));

      const response = await (service as any).spotifyApiCall(
        "https://api.spotify.com/v1/tracks/abc123", makeContext(), "test",
      );
      // The token fetch returned 401, so getSpotifyAccessToken returns null,
      // and the original 401 response is returned.
      expect(response.status).toBe(401);
    });

    it("appleMusicApiCall retries once with a fresh JWT on 401", async () => {
      // Ensure a valid JWT exists first by seeding the cache.
      (service as any).appleMusicJwt = "initial-jwt";
      (service as any).appleMusicJwtExpiry = Date.now() + 86400000;

      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

      // appleMusicApiCall regenerates the JWT synchronously — mock the method.
      const genSpy = jest.spyOn(service as any, "generateAppleMusicJwt")
        .mockReturnValueOnce("old-jwt")
        .mockReturnValueOnce("fresh-jwt");

      const context = { ...makeContext(), provider: "apple-music" as const };
      const response = await (service as any).appleMusicApiCall(
        "https://api.music.apple.com/v1/catalog/us/songs/123", context, "test",
      );

      expect(response.ok).toBe(true);
      expect(genSpy).toHaveBeenCalledTimes(2);
      genSpy.mockRestore();
    });

    it("appleMusicApiCall regenerates once on provider 403 without touching user auth", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      const genSpy = jest.spyOn(service as any, "generateAppleMusicJwt")
        .mockReturnValueOnce("stale-jwt")
        .mockReturnValueOnce("fresh-jwt");
      const context = { ...makeContext(), provider: "apple-music" as const };

      const response = await (service as any).appleMusicApiCall(
        "https://api.music.apple.com/v1/catalog/us/playlists/pl.test",
        context,
        "apple-playlist-lookup",
      );

      expect(response.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(genSpy).toHaveBeenCalledTimes(2);
      genSpy.mockRestore();
    });

    it("does not retry Apple Music provider auth more than once", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
        .mockResolvedValueOnce(new Response("Still forbidden", { status: 403 }));
      jest.spyOn(service as any, "generateAppleMusicJwt")
        .mockReturnValueOnce("stale-jwt")
        .mockReturnValueOnce("fresh-jwt");
      const context = { ...makeContext(), provider: "apple-music" as const };

      const response = await (service as any).appleMusicApiCall(
        "https://api.music.apple.com/v1/catalog/us/playlists/pl.test",
        context,
        "apple-playlist-lookup",
      );

      expect(response.status).toBe(403);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("requires reconnect when a personal Apple Music request remains unauthorized", async () => {
      const connections = {
        requireReauthorization: jest.fn().mockResolvedValue(undefined),
      };
      const connectedService = new MusicService(
        mockConfig as never,
        mockUsersRepo as never,
        null,
        connections as never,
      );
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(new Response("Still unauthorized", { status: 401 }));
      jest.spyOn(connectedService as any, "generateAppleMusicJwt")
        .mockReturnValueOnce("stale-jwt")
        .mockReturnValueOnce("fresh-jwt");
      const context = { ...makeContext(), provider: "apple-music" as const, userId: "user-1" };

      const response = await (connectedService as any).appleMusicApiCall(
        "https://api.music.apple.com/v1/me/library/playlists/p.test",
        context,
        "apple-personal-playlist-lookup",
        { "Music-User-Token": "user-token" },
      );

      expect(response.status).toBe(401);
      expect(connections.requireReauthorization).toHaveBeenCalledWith("user-1", "apple-music");
      connectedService.onModuleDestroy();
    });

    it("maps provider 403 to a non-user-auth HTTP contract", () => {
      const mapped = (service as any).mapResponseToError(
        new Response("Forbidden", { status: 403 }),
        "Apple Music failed",
      );

      expect(mapped).toEqual(expect.objectContaining({
        code: "PROVIDER_AUTH_FAILURE",
        providerStatus: 403,
        status: 503,
      }));
    });
  });

  describe("concurrent requests — deduplication", () => {
    it("deduplicates concurrent token acquisitions via pendingSpotifyToken", async () => {
      let resolveToken!: (v: Response) => void;
      const tokenPromise = new Promise<Response>((resolve) => { resolveToken = resolve; });
      fetchSpy = jest.spyOn(globalThis, "fetch").mockReturnValueOnce(tokenPromise as any);

      // Launch two concurrent calls.
      const p1 = (service as any).getSpotifyAccessToken();
      const p2 = (service as any).getSpotifyAccessToken();

      // Both should share the same pending promise.
      expect((service as any).pendingSpotifyToken).not.toBeNull();

      resolveToken(new Response(JSON.stringify({ access_token: "shared", expires_in: 3600 }), { status: 200 }));

      const [t1, t2] = await Promise.all([p1, p2]);
      expect(t1).toBe("shared");
      expect(t2).toBe("shared");
      // Only one fetch, not two.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("timeout path", () => {
    it("withDeadline rejects with PROVIDER_TIMEOUT when deadline expires", async () => {
      const slowPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve("too late"), 500);
      });

      await expect(
        (service as any).withDeadline(slowPromise, 50, "Test deadline exceeded"),
      ).rejects.toMatchObject({
        code: "PROVIDER_TIMEOUT",
        httpStatus: 504,
        retriable: true,
      });
    });

    it("withDeadline resolves when promise beats the deadline", async () => {
      await expect(
        (service as any).withDeadline(Promise.resolve("fast"), 5000, "nope"),
      ).resolves.toBe("fast");
    });

    it("parseLink delegates to withDeadline with 18s budget", async () => {
      // Block the inner IIFE so no stale fetch calls leak into later tests.
      const prepareSpy = jest.spyOn(service as any, "prepareLink")
        .mockImplementation(() => new Promise(() => {}));
      const deadlineSpy = jest.spyOn(service as any, "withDeadline")
        .mockRejectedValueOnce(Object.assign(new Error("mocked"), { code: "PROVIDER_TIMEOUT", httpStatus: 504, retriable: true }));

      await expect(
        service.parseLink("https://open.spotify.com/track/abc123", "req-deadline"),
      ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });

      expect(deadlineSpy).toHaveBeenCalledWith(
        expect.any(Promise),
        18_000,
        expect.stringContaining("deadline"),
      );
      deadlineSpy.mockRestore();
      prepareSpy.mockRestore();
    });
  });

  describe("provider retry path", () => {
    it("resilientFetch retries 429 then succeeds", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 429 }))
        .mockResolvedValueOnce(new Response("OK", { status: 200 }));

      const response = await (service as any).resilientFetch(
        "https://api.example.com/test", {},
        { operation: "spec", provider: "spotify", requestId: "r1", retries: 1, timeoutMs: 5000 },
      );
      expect(response.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("resilientFetch retries 5xx then succeeds", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 502 }))
        .mockResolvedValueOnce(new Response("OK", { status: 200 }));

      const response = await (service as any).resilientFetch(
        "https://api.example.com/test", {},
        { operation: "spec", provider: "spotify", requestId: "r2", retries: 1, timeoutMs: 5000 },
      );
      expect(response.ok).toBe(true);
    });

    it("resilientFetch does NOT retry 404", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

      const response = await (service as any).resilientFetch(
        "https://api.example.com/test", {},
        { operation: "spec", provider: "spotify", requestId: "r3", retries: 2, timeoutMs: 5000 },
      );
      expect(response.status).toBe(404);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("provider-not-connected contract", () => {
    const playlistContext = (overrides: Record<string, unknown> = {}) => ({
      requestId: "req-nc",
      endpoint: "/music/parse-link",
      provider: "spotify" as const,
      linkType: "playlist" as const,
      normalizedUrl: "https://open.spotify.com/playlist/plabc",
      rawUrl: "https://open.spotify.com/playlist/plabc",
      storefront: null,
      ...overrides,
    });

    it("throws PROVIDER_NOT_CONNECTED (401) when a private Spotify playlist is requested with no user token", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "cc", expires_in: 3600 }), { status: 200 }))
        .mockResolvedValue(new Response("Not Found", { status: 404 }));

      await expect(
        (service as any).listSpotifyPlaylist("plabc", playlistContext()),
      ).rejects.toMatchObject({
        code: "PROVIDER_NOT_CONNECTED",
        provider: "spotify",
        status: 401,
      });
    });

    it("distinguishes connected-but-access-denied (PROVIDER_NOT_FOUND) from not-connected", async () => {
      // User token available but the account can't see the playlist → 404 on user token path,
      // 404 on client-credentials → terminal access-denied, NOT a connect prompt.
      const connections = {
        spotifyAccessToken: jest.fn().mockResolvedValue("user-tok"),
        requireReauthorization: jest.fn().mockResolvedValue(undefined),
      };
      const connectedService = new MusicService(
        mockConfig as never,
        mockUsersRepo as never,
        null,
        connections as never,
      );
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 })) // user-token playlist lookup
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "cc", expires_in: 3600 }), { status: 200 }))
        .mockResolvedValue(new Response("Not Found", { status: 404 })); // client credentials

      await expect(
        (connectedService as any).listSpotifyPlaylist("plabc", playlistContext({ userId: "user-1" })),
      ).rejects.toMatchObject({
        code: "PROVIDER_NOT_FOUND",
        status: 404,
      });
      connectedService.onModuleDestroy();
    });

    it("throws PROVIDER_NOT_CONNECTED (401) for a personal Apple Music playlist with no user token", async () => {
      await expect(
        (service as any).listAppleMusicPlaylist(
          "pl.u-abc123",
          playlistContext({ provider: "apple-music", storefront: "us" }),
        ),
      ).rejects.toMatchObject({
        code: "PROVIDER_NOT_CONNECTED",
        provider: "apple-music",
        status: 401,
      });
    });
  });

  describe("cleanup on shutdown", () => {
    it("clears the refresh timer on module destroy", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ access_token: "sp-token", expires_in: 3600 }), { status: 200 }),
      );

      await service.onModuleInit();
      expect((service as any).spotifyRefreshTimer).not.toBeNull();

      service.onModuleDestroy();
      expect((service as any).spotifyRefreshTimer).toBeNull();
    });

    it("onModuleDestroy is idempotent", () => {
      service.onModuleDestroy();
      service.onModuleDestroy();
      expect((service as any).spotifyRefreshTimer).toBeNull();
    });
  });
});
