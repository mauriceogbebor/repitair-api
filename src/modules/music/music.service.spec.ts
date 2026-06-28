import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";

import { MusicService } from "./music.service";
import { User } from "../../entities";

describe("MusicService", () => {
  let service: MusicService;
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
        SPOTIFY_CLIENT_ID: "test-client-id",
        SPOTIFY_CLIENT_SECRET: "test-client-secret",
        REDIS_URL: "",
      };
      return config[key] ?? undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MusicService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
      ],
    }).compile();

    service = module.get<MusicService>(MusicService);
  });

  describe("detectLinkType", () => {
    it("should detect Spotify track links", () => {
      expect(service.detectLinkType("https://open.spotify.com/track/abc123")).toBe("track");
    });

    it("should detect Spotify album links", () => {
      expect(service.detectLinkType("https://open.spotify.com/album/abc123")).toBe("album");
    });

    it("should detect Spotify playlist links", () => {
      expect(service.detectLinkType("https://open.spotify.com/playlist/abc123")).toBe("playlist");
    });

    it("should detect Apple Music album links", () => {
      expect(service.detectLinkType("https://music.apple.com/us/album/test/12345")).toBe("album");
    });

    it("should detect Apple Music track links (with ?i=)", () => {
      expect(service.detectLinkType("https://music.apple.com/us/album/test/12345?i=67890")).toBe("track");
    });

    it("should detect Apple Music playlist links from iTunes host", () => {
      expect(service.detectLinkType("https://itunes.apple.com/us/playlist/chill-mix/pl.pm-123456789")).toBe("playlist");
    });

    it("should detect Apple Music album links from iTunes host", () => {
      expect(service.detectLinkType("https://itunes.apple.com/us/album/test/12345")).toBe("album");
    });

    it("should detect Apple Music track links from iTunes host (with ?i=)", () => {
      expect(service.detectLinkType("https://itunes.apple.com/us/album/test/12345?i=67890")).toBe("track");
    });
  });

  describe("Apple Music extractors", () => {
    it("should extract storefront from music.apple.com album links", () => {
      expect((service as any).extractAppleMusicStorefront("https://music.apple.com/us/album/album-name/123456789")).toBe("us");
    });

    it("should extract storefront from itunes.apple.com album links", () => {
      expect((service as any).extractAppleMusicStorefront("https://itunes.apple.com/us/album/album-name/123456789")).toBe("us");
    });

    it("should extract album ID from music.apple.com album links", () => {
      expect((service as any).extractAppleMusicAlbumId("https://music.apple.com/us/album/album-name/123456789")).toBe("123456789");
    });

    it("should extract album ID from itunes.apple.com album links", () => {
      expect((service as any).extractAppleMusicAlbumId("https://itunes.apple.com/us/album/album-name/123456789")).toBe("123456789");
    });

    it("should extract playlist ID from music.apple.com playlist links", () => {
      expect((service as any).extractAppleMusicPlaylistId("https://music.apple.com/us/playlist/playlist-name/pl.xxxxx")).toBe("pl.xxxxx");
    });

    it("should extract playlist ID from itunes.apple.com playlist links", () => {
      expect((service as any).extractAppleMusicPlaylistId("https://itunes.apple.com/us/playlist/playlist-name/pl.xxxxx")).toBe("pl.xxxxx");
    });

    it("should extract track ID from music.apple.com album links with ?i=", () => {
      expect((service as any).extractAppleMusicTrackId("https://music.apple.com/us/album/album-name/123456789?i=987654321")).toBe("987654321");
    });

    it("should extract track ID from itunes.apple.com album links with ?i=", () => {
      expect((service as any).extractAppleMusicTrackId("https://itunes.apple.com/us/album/album-name/123456789?i=987654321")).toBe("987654321");
    });
  });

  describe("parseLink", () => {
    it("should reject non-music links", async () => {
      await expect(service.parseLink("https://example.com")).rejects.toThrow(BadRequestException);
    });
  });

  describe("getRecentSongs", () => {
    it("should return empty array without userId", async () => {
      const result = await service.getRecentSongs();
      expect(result).toEqual([]);
    });
  });

  describe("search", () => {
    it("should return empty array for empty query", async () => {
      const result = await service.search("");
      expect(result).toEqual([]);
    });

    it("should return empty array for empty Apple Music query", async () => {
      const result = await service.search("", "apple-music");
      expect(result).toEqual([]);
    });
  });

  describe("resilientFetch (no recursion)", () => {
    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    it("should call global fetch, NOT this.resilientFetch (no infinite recursion)", async () => {
      // If resilientFetch called itself, this would blow the stack immediately.
      // We mock global fetch to return a successful response.
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      // Access the private method via bracket notation
      const result = await (service as any).resilientFetch(
        "https://api.example.com/test",
        { method: "GET" },
      );

      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          method: "GET",
          signal: expect.anything(),
        }),
      );
    });

    it("should retry on 429 and eventually succeed", async () => {
      const rateLimitResponse = new Response("", { status: 429 });
      const successResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });

      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(successResponse);

      const result = await (service as any).resilientFetch(
        "https://api.example.com/test",
        {},
        { retries: 1, timeoutMs: 5000 },
      );

      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("should NOT retry on 400 (client error)", async () => {
      const badRequestResponse = new Response("Bad Request", { status: 400 });

      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(badRequestResponse);

      const result = await (service as any).resilientFetch(
        "https://api.example.com/test",
        {},
        { retries: 1 },
      );

      expect(result.status).toBe(400);
      // Should only call fetch once — no retry for 400
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should NOT retry on 401 (auth error)", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Unauthorized", { status: 401 }),
      );

      const result = await (service as any).resilientFetch(
        "https://api.example.com/test",
        {},
        { retries: 1 },
      );

      expect(result.status).toBe(401);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should NOT retry on 404 (not found)", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Not Found", { status: 404 }),
      );

      const result = await (service as any).resilientFetch(
        "https://api.example.com/test",
        {},
        { retries: 1 },
      );

      expect(result.status).toBe(404);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should retry on 500 server error", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 500 }))
        .mockResolvedValueOnce(new Response("OK", { status: 200 }));

      const result = await (service as any).resilientFetch(
        "https://api.example.com/test",
        {},
        { retries: 1, timeoutMs: 5000 },
      );

      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("should retry on network error and throw if retries exhausted", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(
        new TypeError("fetch failed"),
      );

      await expect(
        (service as any).resilientFetch(
          "https://api.example.com/test",
          {},
          { retries: 1, timeoutMs: 5000 },
        ),
      ).rejects.toThrow("fetch failed");

      // attempt 0 + 1 retry = 2 calls
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("should include AbortSignal.timeout in the fetch call", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("OK", { status: 200 }),
      );

      await (service as any).resilientFetch(
        "https://api.example.com/test",
        {},
        { timeoutMs: 10000 },
      );

      const callArgs = fetchSpy.mock.calls[0];
      const options = callArgs[1];
      expect(options.signal).toBeDefined();
    });
  });

  describe("Spotify token retrieval (fetchSpotifyToken)", () => {
    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    it("should fetch a Spotify client-credentials token successfully", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: "test-token-123", expires_in: 3600 }),
          { status: 200 },
        ),
      );

      const token = await (service as any).fetchSpotifyToken();

      expect(token).toBe("test-token-123");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://accounts.spotify.com/api/token",
        expect.objectContaining({
          method: "POST",
          body: "grant_type=client_credentials",
        }),
      );
      // Verify auth header uses base64-encoded client_id:client_secret
      const callOptions = fetchSpy.mock.calls[0][1];
      const expectedAuth = Buffer.from("test-client-id:test-client-secret").toString("base64");
      expect(callOptions.headers["Authorization"]).toBe(`Basic ${expectedAuth}`);
    });

    it("should return null when Spotify credentials are not configured", async () => {
      // Override config to return undefined for Spotify creds
      mockConfig.get.mockImplementation((key: string): string => {
        if (key === "SPOTIFY_CLIENT_ID" || key === "SPOTIFY_CLIENT_SECRET") return "";
        return "";
      });

      fetchSpy = jest.spyOn(globalThis, "fetch");
      const token = await (service as any).fetchSpotifyToken();

      expect(token).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();

      // Restore config
      mockConfig.get.mockImplementation((key: string) => {
        const config: Record<string, string> = {
          SPOTIFY_CLIENT_ID: "test-client-id",
          SPOTIFY_CLIENT_SECRET: "test-client-secret",
          REDIS_URL: "",
        };
        return config[key] ?? undefined;
      });
    });

    it("should return null when Spotify token endpoint returns non-200", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Unauthorized", { status: 401 }),
      );

      const token = await (service as any).fetchSpotifyToken();

      expect(token).toBeNull();
    });

    it("should return null on network error during token fetch", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error"),
      );

      const token = await (service as any).fetchSpotifyToken();

      expect(token).toBeNull();
    });
  });

  describe("Spotify track lookup (lookupSpotifyTrack)", () => {
    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    it("should parse a Spotify track after token retrieval", async () => {
      const tokenResponse = new Response(
        JSON.stringify({ access_token: "sp-token-xyz", expires_in: 3600 }),
        { status: 200 },
      );

      const trackResponse = new Response(
        JSON.stringify({
          name: "Test Song",
          artists: [{ name: "Test Artist" }, { name: "Featured Artist" }],
          album: { images: [{ url: "https://i.scdn.co/image/abc" }] },
          duration_ms: 210000,
        }),
        { status: 200 },
      );

      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(tokenResponse)  // token fetch
        .mockResolvedValueOnce(trackResponse);  // track lookup

      const result = await (service as any).lookupSpotifyTrack("6rqhFgbbKwnb9MLmUQDhG6");

      expect(result).toEqual({
        platform: "spotify",
        title: "Test Song",
        artist: "Test Artist, Featured Artist",
        albumArt: "https://i.scdn.co/image/abc",
        sourceLink: "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
        durationMs: 210000,
      });

      // First call = token endpoint, second call = track endpoint
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[1][0]).toBe(
        "https://api.spotify.com/v1/tracks/6rqhFgbbKwnb9MLmUQDhG6",
      );
    });

    it("should return null when track lookup returns 404", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: "sp-token", expires_in: 3600 }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response("Not Found", { status: 404 }),
        );

      const result = await (service as any).lookupSpotifyTrack("invalid-id");
      expect(result).toBeNull();
    });
  });

  describe("Apple Music track lookup (lookupAppleMusicTrack)", () => {
    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    it("should return null when Apple Music JWT is not configured", async () => {
      // By default, APPLE_MUSIC_PRIVATE_KEY is not in our mock config,
      // so generateAppleMusicJwt should return null
      fetchSpy = jest.spyOn(globalThis, "fetch");

      const result = await (service as any).lookupAppleMusicTrack("123456", "us");

      expect(result).toBeNull();
      // fetch should never be called if JWT generation fails
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("log safety", () => {
    it("should log pathname not full URL with query params in resilientFetch warnings", async () => {
      const logSpy = jest.spyOn((service as any).logger, "warn");
      const fetchSpy = jest.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 500 }))
        .mockResolvedValueOnce(new Response("OK", { status: 200 }));

      await (service as any).resilientFetch(
        "https://accounts.spotify.com/api/token?secret=hunter2",
        {},
        { retries: 1, timeoutMs: 5000 },
      );

      // The warn log should contain the pathname, not the secret
      expect(logSpy).toHaveBeenCalled();
      const warnMessage = logSpy.mock.calls[0][0] as string;
      expect(warnMessage).toContain("/api/token");
      expect(warnMessage).not.toContain("hunter2");

      logSpy.mockRestore();
      fetchSpy.mockRestore();
    });
  });
});
