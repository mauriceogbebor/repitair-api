import { AuthService } from "./auth.service";

describe("music provider OAuth", () => {
  const users = { connectSpotify: jest.fn(), connectAppleMusic: jest.fn() };
  const jwt = {};
  const mail = {};
  const blacklist = {};
  const config = {
    get: jest.fn((key: string) => ({
      SPOTIFY_CLIENT_ID: "spotify-client",
      SPOTIFY_REDIRECT_URI: "https://api.repitair.com/api/auth/spotify/callback",
      SPOTIFY_CLIENT_SECRET: "spotify-secret",
      APPLE_MUSIC_TEAM_ID: "team",
      APPLE_MUSIC_KEY_ID: "key",
      APPLE_MUSIC_PRIVATE_KEY: "private-key",
      APPLE_MUSIC_AUTH_BASE_URL: "https://api-staging.repitair.com/api",
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
    expect(String(request.body)).not.toContain("client_id=");
    expect((request.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(connections.consumeOAuthState).toHaveBeenCalledWith("single-use-state", "spotify");
    expect(connections.connectSpotify).toHaveBeenCalledWith("user-1", expect.objectContaining({ refresh_token: "refresh-token" }));
  });

  it("uses a public PKCE token exchange when no Spotify client secret is configured", async () => {
    const publicConfig = {
      get: jest.fn((key: string) => ({
        SPOTIFY_CLIENT_ID: "spotify-client",
        SPOTIFY_REDIRECT_URI: "https://api.repitair.com/api/auth/spotify/callback",
        JWT_SECRET: "test-secret",
      } as Record<string, string>)[key]),
    };
    const publicService = new AuthService(
      users as never,
      jwt as never,
      mail as never,
      blacklist as never,
      publicConfig as never,
      appleIdentity as never,
      socialIdentity as never,
      connections as never,
    );
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: "playlist-read-private",
    }), { status: 200 }));

    await publicService.handleSpotifyCallback("authorization-code", "single-use-state");

    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain("client_id=spotify-client");
    expect(String(request.body)).toContain("code_verifier=pkce-verifier");
    expect((request.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("validates Apple Music authorization state before exposing MusicKit", async () => {
    await service.validateAppleMusicAuthorizationState("single-use-state");

    expect(connections.validateOAuthState).toHaveBeenCalledWith("single-use-state", "apple-music");
  });

  it("serves MusicKit from the explicitly approved Apple Music origin", async () => {
    const url = new URL(await service.buildAppleMusicAuthUrl("user-1"));

    expect(url.origin).toBe("https://api-staging.repitair.com");
    expect(url.pathname).toBe("/api/auth/apple-music/authorize");
    expect(url.searchParams.get("state")).toBe("single-use-state");
  });

  it("refuses to serve MusicKit from an implicit production or Railway origin", async () => {
    const productionConfig = {
      get: jest.fn((key: string) => ({
        APPLE_MUSIC_TEAM_ID: "team",
        APPLE_MUSIC_KEY_ID: "key",
        APPLE_MUSIC_PRIVATE_KEY: "private-key",
        API_BASE_URL: "https://repitair-api-staging-staging.up.railway.app/api",
        NODE_ENV: "production",
        JWT_SECRET: "test-secret",
      } as Record<string, string>)[key]),
    };
    const productionService = new AuthService(
      users as never, jwt as never, mail as never, blacklist as never,
      productionConfig as never, appleIdentity as never, socialIdentity as never, connections as never,
    );

    await expect(productionService.buildAppleMusicAuthUrl("user-1")).rejects.toThrow(
      "APPLE_MUSIC_AUTH_BASE_URL",
    );
  });

  describe("developer token well-formedness", () => {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const future = Math.floor(Date.now() / 1000) + 3600;
    const past = Math.floor(Date.now() / 1000) - 3600;
    const makeToken = (header: unknown, payload: unknown) => `${b64(header)}.${b64(payload)}.sig`;

    it("accepts a structurally valid ES256 developer token", () => {
      const token = makeToken({ alg: "ES256", kid: "key", typ: "JWT" }, { iss: "team", iat: 0, exp: future });
      expect(service.isDeveloperTokenWellFormed(token)).toBe(true);
    });

    it("rejects null, wrong segment counts, and non-JWT strings", () => {
      expect(service.isDeveloperTokenWellFormed(null)).toBe(false);
      expect(service.isDeveloperTokenWellFormed("")).toBe(false);
      expect(service.isDeveloperTokenWellFormed("a.b")).toBe(false);
      expect(service.isDeveloperTokenWellFormed("not-a-token")).toBe(false);
    });

    it("rejects wrong alg, missing kid/iss, and expired tokens", () => {
      expect(service.isDeveloperTokenWellFormed(makeToken({ alg: "HS256", kid: "key" }, { iss: "team", exp: future }))).toBe(false);
      expect(service.isDeveloperTokenWellFormed(makeToken({ alg: "ES256" }, { iss: "team", exp: future }))).toBe(false);
      expect(service.isDeveloperTokenWellFormed(makeToken({ alg: "ES256", kid: "key" }, { exp: future }))).toBe(false);
      expect(service.isDeveloperTokenWellFormed(makeToken({ alg: "ES256", kid: "key" }, { iss: "team", exp: past }))).toBe(false);
    });
  });

  describe("MusicKit developer token signing", () => {
    it("produces a verifiable ES256 (JOSE) JWT — not a DER-signed token Apple rejects", () => {
      const { generateKeyPairSync } = require("crypto") as typeof import("crypto");
      const jwtLib = require("jsonwebtoken") as typeof import("jsonwebtoken");
      const { privateKey, publicKey } = generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      const cfg = {
        get: jest.fn((key: string) => ({
          APPLE_MUSIC_TEAM_ID: "TEAM123456",
          APPLE_MUSIC_KEY_ID: "KEY1234567",
          APPLE_MUSIC_PRIVATE_KEY: privateKey,
          JWT_SECRET: "test-secret",
        } as Record<string, string>)[key]),
      };
      const svc = new AuthService(
        users as never, jwt as never, mail as never, blacklist as never,
        cfg as never, appleIdentity as never, socialIdentity as never, connections as never,
      );

      const token = svc.generateMusicKitDeveloperToken();
      expect(token).toBeTruthy();

      // The DER-signature bug produced a signature Apple could not verify
      // (ERROR_FAILED_TO_VERIFY_JWT). A correct JOSE ES256 signature verifies
      // against the public key and is exactly 64 bytes (raw r‖s for P-256).
      const decoded = jwtLib.verify(token as string, publicKey, { algorithms: ["ES256"] }) as { iss?: string };
      expect(decoded.iss).toBe("TEAM123456");
      expect(Buffer.from((token as string).split(".")[2], "base64url").length).toBe(64);

      const header = JSON.parse(Buffer.from((token as string).split(".")[0], "base64url").toString("utf8"));
      expect(header).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
      expect(svc.isDeveloperTokenWellFormed(token)).toBe(true);
      // Self-verification derives the public key from the same private key and
      // confirms the signature — the guard behind ERROR_FAILED_TO_VERIFY_JWT.
      expect(svc.developerTokenSelfVerifies(token)).toBe(true);
    });

    it("self-verification fails for a token signed by a different key", () => {
      const { generateKeyPairSync } = require("crypto") as typeof import("crypto");
      const jwtLib = require("jsonwebtoken") as typeof import("jsonwebtoken");
      const configuredKey = generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      }).privateKey;
      const strangerKey = generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      }).privateKey;
      const cfg = {
        get: jest.fn((key: string) => ({
          APPLE_MUSIC_TEAM_ID: "TEAM123456",
          APPLE_MUSIC_KEY_ID: "KEY1234567",
          APPLE_MUSIC_PRIVATE_KEY: configuredKey,
          JWT_SECRET: "test-secret",
        } as Record<string, string>)[key]),
      };
      const svc = new AuthService(
        users as never, jwt as never, mail as never, blacklist as never,
        cfg as never, appleIdentity as never, socialIdentity as never, connections as never,
      );
      // A well-formed token signed by an UNRELATED key must not self-verify.
      const foreignToken = jwtLib.sign({}, strangerKey, {
        algorithm: "ES256", expiresIn: "180d", header: { alg: "ES256", kid: "KEY1234567" }, issuer: "TEAM123456",
      });
      expect(svc.isDeveloperTokenWellFormed(foreignToken)).toBe(true);
      expect(svc.developerTokenSelfVerifies(foreignToken)).toBe(false);
    });
  });

  describe("OAuth config diagnostics", () => {
    it("reports readiness with secret-free booleans and the non-secret redirect URI", () => {
      const report = service.getOAuthConfigDiagnostics();

      expect(report.apiBaseUrl).toEqual({ configured: true, isLocalhost: false });
      expect(report.spotify).toEqual({
        clientId: true,
        clientSecret: true,
        redirectUri: "https://api.repitair.com/api/auth/spotify/callback",
        redirectUriHttps: true,
        redirectUriCallbackPath: true,
        redirectUriValid: true,
        ready: true,
      });
      // The fake ES256 key in this suite cannot actually sign, so token
      // generation fails → Apple Music is reported not-ready (exactly the
      // signal a misconfigured staging deploy should surface).
      expect(report.appleMusic.teamId).toBe(true);
      expect(report.appleMusic.authBaseUrlConfigured).toBe(true);
      expect(report.appleMusic.authBaseUrlHttps).toBe(true);
      expect(report.appleMusic.authBaseUrlUsesRailwayDomain).toBe(false);
      expect(report.appleMusic.keyId).toBe(true);
      expect(report.appleMusic.privateKey).toBe(true);
      expect(report.appleMusic.developerTokenWellFormed).toBe(false);
      expect(report.appleMusic.developerTokenSelfVerifies).toBe(false);
      expect(report.appleMusic.ready).toBe(false);
      // No secret material leaks into the report.
      expect(JSON.stringify(report)).not.toContain("spotify-secret");
      expect(JSON.stringify(report)).not.toContain("private-key");
    });

    it("flags a localhost API base URL", () => {
      const localConfig = {
        get: jest.fn((key: string) => ({ ...({
          SPOTIFY_CLIENT_ID: "spotify-client",
          SPOTIFY_REDIRECT_URI: "https://api.repitair.com/api/auth/spotify/callback",
          API_BASE_URL: "http://localhost:3000",
          JWT_SECRET: "test-secret",
        } as Record<string, string>) })[key]),
      };
      const localService = new AuthService(
        users as never, jwt as never, mail as never, blacklist as never,
        localConfig as never, appleIdentity as never, socialIdentity as never, connections as never,
      );
      const report = localService.getOAuthConfigDiagnostics();
      expect(report.apiBaseUrl).toEqual({ configured: true, isLocalhost: true });
    });
  });
});
