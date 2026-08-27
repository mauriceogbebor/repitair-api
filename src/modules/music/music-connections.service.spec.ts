import { MusicConnectionsService } from "./music-connections.service";

describe("MusicConnectionsService", () => {
  const rows: Record<string, unknown>[] = [];
  const connectionRepo = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      const existingIndex = rows.findIndex((row) => row.userId === value.userId && row.provider === value.provider);
      const saved = { id: existingIndex >= 0 ? rows[existingIndex].id : `connection-${rows.length + 1}`, ...value };
      if (existingIndex >= 0) rows[existingIndex] = saved;
      else rows.push(saved);
      return saved;
    }),
    find: jest.fn(async ({ where }: { where: { userId: string } }) => rows.filter((row) => row.userId === where.userId)),
    delete: jest.fn(async ({ userId, provider }: { userId: string; provider: string }) => {
      const index = rows.findIndex((row) => row.userId === userId && row.provider === provider);
      if (index >= 0) rows.splice(index, 1);
    }),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => {
      let userId = "";
      let provider = "";
      const qb: Record<string, jest.Mock> = {};
      qb.where = jest.fn((_query: string, params: { userId: string }) => { userId = params.userId; return qb; });
      qb.andWhere = jest.fn((_query: string, params: { provider: string }) => { provider = params.provider; return qb; });
      qb.addSelect = jest.fn(() => qb);
      qb.getOne = jest.fn(async () => rows.find((row) => row.userId === userId && row.provider === provider) ?? null);
      return qb;
    }),
  };
  const oauthStateRepo = { save: jest.fn(), create: jest.fn((value) => value) };
  const user = {
    id: "user-1",
    email: "tester@repitair.com",
    connectedPlatforms: [] as string[],
  };
  const userRepo = {
    findOne: jest.fn(async () => user),
    save: jest.fn(async (value) => value),
    createQueryBuilder: jest.fn(() => {
      const qb: Record<string, jest.Mock> = {};
      qb.update = jest.fn(() => qb);
      qb.set = jest.fn(() => qb);
      qb.where = jest.fn(() => qb);
      qb.execute = jest.fn(async () => ({}));
      return qb;
    }),
  };
  const configValues: Record<string, string> = {
      MUSIC_TOKEN_ENCRYPTION_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      NODE_ENV: "test",
      SPOTIFY_CLIENT_ID: "spotify-client",
      SPOTIFY_CLIENT_SECRET: "spotify-secret",
      MUSIC_PROVIDER_CONNECTIONS_ENABLED: "true",
      MUSIC_PROVIDER_CONNECTION_ALLOWLIST: "tester@repitair.com",
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback),
  };
  const analytics = { track: jest.fn().mockResolvedValue(undefined) };
  let service: MusicConnectionsService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    rows.splice(0);
    user.connectedPlatforms = [];
    configValues.MUSIC_PROVIDER_CONNECTIONS_ENABLED = "true";
    configValues.MUSIC_PROVIDER_CONNECTION_ALLOWLIST = "tester@repitair.com";
    jest.clearAllMocks();
    service = new MusicConnectionsService(
      config as never,
      connectionRepo as never,
      oauthStateRepo as never,
      userRepo as never,
      analytics as never,
    );
  });

  afterEach(() => fetchSpy?.mockRestore());

  it("fails closed when provider connections are disabled", async () => {
    configValues.MUSIC_PROVIDER_CONNECTIONS_ENABLED = "false";

    await expect(service.listConnections("user-1")).rejects.toMatchObject({ status: 404 });
    expect(connectionRepo.find).not.toHaveBeenCalled();
  });

  it("rejects authenticated users who are not in the staging allowlist", async () => {
    configValues.MUSIC_PROVIDER_CONNECTION_ALLOWLIST = "another@repitair.com";

    await expect(service.spotifyAccessToken("user-1")).rejects.toMatchObject({ status: 404 });
    expect(connectionRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it("stores Spotify authorization encrypted and returns only shaped account metadata", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "spotify-user", display_name: "Listener" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 43 }), { status: 200 }));

    await service.connectSpotify("user-1", {
      access_token: "raw-access-token",
      refresh_token: "raw-refresh-token",
      expires_in: 3600,
      scope: "playlist-read-private playlist-read-collaborative",
    });

    expect(rows[0].encryptedAccessToken).not.toBe("raw-access-token");
    expect(rows[0].encryptedRefreshToken).not.toBe("raw-refresh-token");
    expect(String(rows[0].encryptedAccessToken)).toMatch(/^v1\./);
    expect(user.connectedPlatforms).toEqual(["spotify"]);
    const summary = await service.listConnections("user-1");
    expect(summary[0]).toEqual(expect.objectContaining({ provider: "spotify", accountName: "Listener", playlistCount: 43 }));
    expect(JSON.stringify(summary)).not.toContain("raw-access-token");
    expect(JSON.stringify(summary)).not.toContain("raw-refresh-token");
  });

  it("reports when Spotify rejects an account that is not approved for the development app", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { status: 403 } }), { status: 403 }),
    );

    await expect(service.connectSpotify("user-1", {
      access_token: "raw-access-token",
      refresh_token: "raw-refresh-token",
      expires_in: 3600,
      scope: "playlist-read-private",
    })).rejects.toMatchObject({
      status: 400,
      response: {
        errorCode: "SPOTIFY_ACCOUNT_NOT_ALLOWED",
        message: expect.stringContaining("approved tester"),
      },
    });
    expect(rows).toHaveLength(0);
  });

  it("refreshes an expired Spotify token on the backend and preserves a rotated refresh token", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "spotify-user" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1 }), { status: 200 }));
    await service.connectSpotify("user-1", {
      access_token: "expired-access",
      refresh_token: "original-refresh",
      expires_in: 60,
      scope: "playlist-read-private",
    });
    (rows[0] as { accessTokenExpiresAt: Date }).accessTokenExpiresAt = new Date(0);
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: "fresh-access",
      refresh_token: "rotated-refresh",
      expires_in: 3600,
      scope: "playlist-read-private",
    }), { status: 200 }));

    await expect(service.spotifyAccessToken("user-1")).resolves.toBe("fresh-access");
    const request = fetchSpy.mock.calls[2]?.[1] as RequestInit;
    expect(String(request.body)).toContain("grant_type=refresh_token");
    expect(String(rows[0].encryptedRefreshToken)).not.toContain("rotated-refresh");
  });

  it("disconnects the provider, clears the profile flag, and emits an audit-safe event", async () => {
    rows.push({ id: "connection-1", userId: "user-1", provider: "spotify", status: "connected" });
    user.connectedPlatforms = ["spotify", "apple-music"];

    await service.disconnect("user-1", "spotify");

    expect(rows).toHaveLength(0);
    expect(user.connectedPlatforms).toEqual(["apple-music"]);
    expect(analytics.track).toHaveBeenCalledWith("music.account_disconnected", {
      userId: "user-1",
      properties: { provider: "spotify" },
    });
  });
});
