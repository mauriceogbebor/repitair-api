import { AuthService } from "./auth.service";

describe("music provider OAuth", () => {
  const users = { connectSpotify: jest.fn(), connectAppleMusic: jest.fn() };
  const jwt = {};
  const mail = {};
  const blacklist = {};
  const config = {
    get: jest.fn((key: string) => ({
      SPOTIFY_CLIENT_ID: "spotify-client",
      SPOTIFY_REDIRECT_URI: "https://api.repitair.com/auth/spotify/callback",
      SPOTIFY_CLIENT_SECRET: "spotify-secret",
      APPLE_MUSIC_TEAM_ID: "team",
      APPLE_MUSIC_KEY_ID: "key",
      APPLE_MUSIC_PRIVATE_KEY: "private-key",
      API_BASE_URL: "https://api.repitair.com",
      JWT_SECRET: "test-secret",
    })[key]),
  };
  const connections = {
    createOAuthState: jest.fn().mockResolvedValue("single-use-state"),
    validateOAuthState: jest.fn().mockResolvedValue(undefined),
    consumeOAuthState: jest.fn().mockResolvedValue({ userId: "user-1", codeVerifier: "pkce-verifier" }),
    connectSpotify: jest.fn().mockResolvedValue(undefined),
    connectAppleMusic: jest.fn().mockResolvedValue(undefined),
  };
  // Apple *identity* verification (Sign in with Apple) is distinct from Apple
  // *Music*; this OAuth suite never exercises it, so a bare stub suffices.
  const appleIdentity = { verifyIdentityToken: jest.fn() };
  const socialIdentity = { resolveUser: jest.fn(), linkToUser: jest.fn(), getLinkedProviders: jest.fn() };
  let service: AuthService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      users as never,
      jwt as never,
      mail as never,
      blacklist as never,
      config as never,
      appleIdentity as never,
      socialIdentity as never,
      connections as never,
    );
  });

  afterEach(() => fetchSpy?.mockRestore());

  it("uses Spotify Authorization Code Flow with PKCE and one-time state", async () => {
    const url = new URL(await service.buildSpotifyAuthUrl("user-1"));

    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("scope")).toContain("playlist-read-private");
    expect(connections.createOAuthState).toHaveBeenCalledWith("user-1", "spotify", expect.any(String));
  });

  it("binds the PKCE verifier to the token exchange and persists through the connection service", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: "playlist-read-private playlist-read-collaborative",
    }), { status: 200 }));

    await service.handleSpotifyCallback("authorization-code", "single-use-state");

    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain("code_verifier=pkce-verifier");
    expect(connections.consumeOAuthState).toHaveBeenCalledWith("single-use-state", "spotify");
    expect(connections.connectSpotify).toHaveBeenCalledWith("user-1", expect.objectContaining({ refresh_token: "refresh-token" }));
  });

  it("validates Apple Music authorization state before exposing MusicKit", async () => {
    await service.validateAppleMusicAuthorizationState("single-use-state");

    expect(connections.validateOAuthState).toHaveBeenCalledWith("single-use-state", "apple-music");
  });
});
