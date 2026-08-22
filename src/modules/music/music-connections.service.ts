import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { LessThan, Repository } from "typeorm";

import {
  MusicConnection,
  MusicOAuthState,
  type MusicProviderName,
  User,
} from "../../entities";
import { AnalyticsService } from "../analytics/analytics.service";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 12_000;

type SpotifyTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

export type MusicConnectionSummary = {
  provider: MusicProviderName;
  status: "connected" | "reauth_required" | "disconnected";
  accountName: string | null;
  providerUserId: string | null;
  playlistCount: number | null;
  scopes: string[];
  lastSyncedAt: string | null;
  connectedAt: string | null;
};

@Injectable()
export class MusicConnectionsService {
  private readonly logger = new Logger(MusicConnectionsService.name);
  private readonly pendingSpotifyRefreshes = new Map<string, Promise<string>>();

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(MusicConnection)
    private readonly connectionRepo: Repository<MusicConnection>,
    @InjectRepository(MusicOAuthState)
    private readonly oauthStateRepo: Repository<MusicOAuthState>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly analytics: AnalyticsService,
  ) {}

  private providerConnectionsEnabled(): boolean {
    return this.config.get<string>("MUSIC_PROVIDER_CONNECTIONS_ENABLED", "false")
      .trim()
      .toLowerCase() === "true";
  }

  private providerConnectionAllowlist(): Set<string> {
    return new Set(
      this.config
        .get<string>("MUSIC_PROVIDER_CONNECTION_ALLOWLIST", "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  async assertProviderAccess(userId: string): Promise<void> {
    if (!this.providerConnectionsEnabled()) {
      throw new NotFoundException("Music account connections are not available.");
    }

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, email: true },
    });
    const email = user?.email?.trim().toLowerCase();
    if (!email || !this.providerConnectionAllowlist().has(email)) {
      throw new NotFoundException("Music account connections are not available.");
    }
  }

  private tokenKey(): Buffer {
    const configured = this.config.get<string>("MUSIC_TOKEN_ENCRYPTION_KEY")?.trim();
    if (configured) {
      if (/^[0-9a-f]{64}$/i.test(configured)) return Buffer.from(configured, "hex");
      try {
        const decoded = Buffer.from(configured, "base64");
        if (decoded.length === 32) return decoded;
      } catch {
        // Fall through to the explicit configuration error below.
      }
      throw new ServiceUnavailableException(
        "MUSIC_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 value or 64-character hex value.",
      );
    }

    if (this.config.get<string>("NODE_ENV") === "production") {
      throw new ServiceUnavailableException(
        "Music account connections require MUSIC_TOKEN_ENCRYPTION_KEY.",
      );
    }

    const fallback = this.config.get<string>("JWT_SECRET");
    if (!fallback) {
      throw new ServiceUnavailableException(
        "Music account connections require MUSIC_TOKEN_ENCRYPTION_KEY.",
      );
    }
    return createHash("sha256").update(`repitair:music-token:v1:${fallback}`).digest();
  }

  private seal(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.tokenKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  private open(value?: string | null): string | null {
    if (!value) return null;
    const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(".");
    if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
      throw new ServiceUnavailableException("Stored music authorization is unreadable. Reconnect the provider.");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.tokenKey(), Buffer.from(ivRaw, "base64url"));
      decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new ServiceUnavailableException("Stored music authorization is unreadable. Reconnect the provider.");
    }
  }

  private hashState(state: string): string {
    return createHash("sha256").update(state).digest("hex");
  }

  async createOAuthState(
    userId: string,
    provider: MusicProviderName,
    codeVerifier?: string,
  ): Promise<string> {
    await this.assertProviderAccess(userId);
    const state = randomBytes(32).toString("base64url");
    await this.oauthStateRepo.delete({ expiresAt: LessThan(new Date()) });
    await this.oauthStateRepo.save(
      this.oauthStateRepo.create({
        userId,
        provider,
        stateHash: this.hashState(state),
        encryptedCodeVerifier: codeVerifier ? this.seal(codeVerifier) : null,
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      }),
    );
    return state;
  }

  async validateOAuthState(
    state: string,
    provider: MusicProviderName,
  ): Promise<void> {
    if (!state?.trim()) {
      throw new BadRequestException("Invalid or expired music authorization state.");
    }
    const row = await this.oauthStateRepo.findOne({
      where: { stateHash: this.hashState(state), provider },
    });
    if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Invalid or expired music authorization state.");
    }
    await this.assertProviderAccess(row.userId);
  }

  async consumeOAuthState(
    state: string,
    provider: MusicProviderName,
  ): Promise<{ userId: string; codeVerifier: string | null }> {
    if (!state?.trim()) throw new BadRequestException("Invalid or expired music authorization state.");

    return this.oauthStateRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(MusicOAuthState);
      const row = await repo
        .createQueryBuilder("state")
        .addSelect("state.encryptedCodeVerifier")
        .setLock("pessimistic_write")
        .where("state.stateHash = :stateHash", { stateHash: this.hashState(state) })
        .andWhere("state.provider = :provider", { provider })
        .getOne();

      if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException("Invalid or expired music authorization state.");
      }

      await this.assertProviderAccess(row.userId);

      row.consumedAt = new Date();
      await repo.save(row);
      return {
        userId: row.userId,
        codeVerifier: this.open(row.encryptedCodeVerifier),
      };
    });
  }

  private async findConnection(
    userId: string,
    provider: MusicProviderName,
    withSecrets = false,
  ): Promise<MusicConnection | null> {
    const qb = this.connectionRepo
      .createQueryBuilder("connection")
      .where("connection.userId = :userId", { userId })
      .andWhere("connection.provider = :provider", { provider });
    if (withSecrets) {
      qb.addSelect(["connection.encryptedAccessToken", "connection.encryptedRefreshToken"]);
    }
    return qb.getOne();
  }

  /** The connected account's provider-side user id (e.g. Spotify user id), used
   *  to distinguish playlists the user owns from ones they merely follow. */
  async providerUserId(userId: string, provider: MusicProviderName): Promise<string | null> {
    const row = await this.connectionRepo.findOne({ where: { userId, provider } });
    return row?.providerUserId ?? null;
  }

  async listConnections(userId: string): Promise<MusicConnectionSummary[]> {
    await this.assertProviderAccess(userId);
    let rows = await this.connectionRepo.find({
      where: { userId },
      order: { provider: "ASC" },
    });
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (user?.connectedPlatforms.includes("spotify") && !rows.some((row) => row.provider === "spotify")) {
      await this.migrateLegacySpotifyConnection(userId);
    }
    if (user?.connectedPlatforms.includes("apple-music") && !rows.some((row) => row.provider === "apple-music")) {
      await this.migrateLegacyAppleConnection(userId);
    }
    rows = await this.connectionRepo.find({
      where: { userId },
      order: { provider: "ASC" },
    });
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    return (["spotify", "apple-music"] as const).map((provider) => {
      const row = byProvider.get(provider);
      return {
        provider,
        status: row?.status ?? "disconnected",
        accountName: row?.accountName ?? null,
        providerUserId: row?.providerUserId ?? null,
        playlistCount: row?.playlistCount ?? null,
        scopes: row?.scopes ?? [],
        lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
        connectedAt: row?.createdAt?.toISOString() ?? null,
      };
    });
  }

  async connectSpotify(
    userId: string,
    token: SpotifyTokenResponse,
  ): Promise<void> {
    await this.assertProviderAccess(userId);
    const profileResponse = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!profileResponse.ok) {
      throw new BadRequestException("Spotify did not authorize this account.");
    }
    const profile = await profileResponse.json() as { id: string; display_name?: string | null };

    const playlistsResponse = await fetch("https://api.spotify.com/v1/me/playlists?limit=1", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    const playlistCount = playlistsResponse.ok
      ? Number(((await playlistsResponse.json()) as { total?: number }).total ?? 0)
      : null;
    const existing = await this.findConnection(userId, "spotify", true);
    await this.connectionRepo.save(
      this.connectionRepo.create({
        ...(existing ?? {}),
        userId,
        provider: "spotify",
        status: "connected",
        encryptedAccessToken: this.seal(token.access_token),
        encryptedRefreshToken: token.refresh_token
          ? this.seal(token.refresh_token)
          : existing?.encryptedRefreshToken ?? null,
        accessTokenExpiresAt: new Date(Date.now() + Math.max(60, token.expires_in) * 1000),
        scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
        providerUserId: profile.id,
        accountName: profile.display_name?.trim() || "Spotify account",
        playlistCount,
        lastSyncedAt: new Date(),
        lastErrorCode: null,
      }),
    );
    await this.addConnectedPlatform(userId, "spotify");
    await this.analytics.track("music.spotify_connected", {
      userId,
      properties: { playlistCount },
    });
  }

  async connectAppleMusic(userId: string, userToken: string): Promise<void> {
    await this.assertProviderAccess(userId);
    if (!userToken.trim()) throw new BadRequestException("Apple Music authorization is missing.");
    const existing = await this.findConnection(userId, "apple-music", true);
    await this.connectionRepo.save(
      this.connectionRepo.create({
        ...(existing ?? {}),
        userId,
        provider: "apple-music",
        status: "connected",
        encryptedAccessToken: this.seal(userToken),
        encryptedRefreshToken: null,
        accessTokenExpiresAt: null,
        scopes: ["library-read"],
        providerUserId: null,
        accountName: "Apple Music account",
        lastSyncedAt: new Date(),
        lastErrorCode: null,
      }),
    );
    await this.addConnectedPlatform(userId, "apple-music");
    await this.analytics.track("music.apple_connected", { userId });
  }

  private async addConnectedPlatform(userId: string, provider: MusicProviderName): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException("Repitair user no longer exists.");
    if (!user.connectedPlatforms.includes(provider)) {
      user.connectedPlatforms = [...user.connectedPlatforms, provider];
      await this.userRepo.save(user);
    }
  }

  private connectionRequired(provider: MusicProviderName): ConflictException {
    return new ConflictException({
      errorCode: "MUSIC_CONNECTION_REQUIRED",
      message: `Connect ${provider === "spotify" ? "Spotify" : "Apple Music"} to access account playlists.`,
      provider,
      retriable: false,
    });
  }

  private async markReauthRequired(connection: MusicConnection, code: string): Promise<void> {
    connection.status = "reauth_required";
    connection.lastErrorCode = code;
    connection.encryptedAccessToken = null;
    connection.encryptedRefreshToken = null;
    connection.accessTokenExpiresAt = null;
    await this.connectionRepo.save(connection);
    const user = await this.userRepo.findOne({ where: { id: connection.userId } });
    if (user) {
      user.connectedPlatforms = user.connectedPlatforms.filter((entry) => entry !== connection.provider);
      await this.userRepo.save(user);
    }
  }

  async spotifyAccessToken(userId: string): Promise<string> {
    await this.assertProviderAccess(userId);
    const pending = this.pendingSpotifyRefreshes.get(userId);
    if (pending) return pending;
    const operation = this.spotifyAccessTokenInternal(userId);
    this.pendingSpotifyRefreshes.set(userId, operation);
    try {
      return await operation;
    } finally {
      this.pendingSpotifyRefreshes.delete(userId);
    }
  }

  private async spotifyAccessTokenInternal(userId: string): Promise<string> {
    let connection = await this.findConnection(userId, "spotify", true);
    if (!connection) {
      connection = await this.migrateLegacySpotifyConnection(userId);
    }
    if (!connection || connection.status !== "connected") throw this.connectionRequired("spotify");

    const accessToken = this.open(connection.encryptedAccessToken);
    if (
      accessToken
      && connection.accessTokenExpiresAt
      && connection.accessTokenExpiresAt.getTime() - ACCESS_TOKEN_REFRESH_MARGIN_MS > Date.now()
    ) {
      return accessToken;
    }

    const refreshToken = this.open(connection.encryptedRefreshToken);
    if (!refreshToken) {
      await this.markReauthRequired(connection, "MISSING_REFRESH_TOKEN");
      throw this.connectionRequired("spotify");
    }

    const clientId = this.config.get<string>("SPOTIFY_CLIENT_ID");
    const clientSecret = this.config.get<string>("SPOTIFY_CLIENT_SECRET");
    if (!clientId) {
      throw new ServiceUnavailableException("Spotify connection is not configured.");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        ...(!clientSecret ? { client_id: clientId } : {}),
      }).toString(),
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        await this.markReauthRequired(connection, "TOKEN_REFRESH_REJECTED");
      }
      throw new ConflictException({
        errorCode: response.status === 400 || response.status === 401
          ? "MUSIC_CONNECTION_EXPIRED"
          : "PROVIDER_UNAVAILABLE",
        message: response.status === 400 || response.status === 401
          ? "Reconnect Spotify to continue."
          : "Spotify authorization could not be refreshed.",
        provider: "spotify",
        retriable: response.status >= 500,
      });
    }

    const token = await response.json() as SpotifyTokenResponse;
    connection.encryptedAccessToken = this.seal(token.access_token);
    if (token.refresh_token) connection.encryptedRefreshToken = this.seal(token.refresh_token);
    connection.accessTokenExpiresAt = new Date(Date.now() + Math.max(60, token.expires_in) * 1000);
    if (token.scope) connection.scopes = token.scope.split(/\s+/).filter(Boolean);
    connection.status = "connected";
    connection.lastErrorCode = null;
    await this.connectionRepo.save(connection);
    return token.access_token;
  }

  private async migrateLegacySpotifyConnection(userId: string): Promise<MusicConnection | null> {
    const user = await this.userRepo
      .createQueryBuilder("user")
      .addSelect("user.spotifyRefreshToken")
      .where("user.id = :userId", { userId })
      .getOne();
    if (!user?.spotifyRefreshToken) return null;
    const connection = await this.connectionRepo.save(
      this.connectionRepo.create({
        userId,
        provider: "spotify",
        status: "connected",
        encryptedRefreshToken: this.seal(user.spotifyRefreshToken),
        encryptedAccessToken: null,
        accessTokenExpiresAt: null,
        scopes: ["playlist-read-private", "playlist-read-collaborative"],
        accountName: "Spotify account",
      }),
    );
    await this.clearLegacyToken(userId, "spotifyRefreshToken");
    return (await this.findConnection(userId, "spotify", true)) ?? connection;
  }

  async appleMusicUserToken(userId: string): Promise<string> {
    await this.assertProviderAccess(userId);
    let connection = await this.findConnection(userId, "apple-music", true);
    if (!connection) connection = await this.migrateLegacyAppleConnection(userId);
    if (!connection || connection.status !== "connected") throw this.connectionRequired("apple-music");
    const token = this.open(connection.encryptedAccessToken);
    if (!token) {
      await this.markReauthRequired(connection, "MISSING_USER_TOKEN");
      throw this.connectionRequired("apple-music");
    }
    return token;
  }

  private async migrateLegacyAppleConnection(userId: string): Promise<MusicConnection | null> {
    const user = await this.userRepo
      .createQueryBuilder("user")
      .addSelect("user.appleMusicUserToken")
      .where("user.id = :userId", { userId })
      .getOne();
    if (!user?.appleMusicUserToken) return null;
    await this.connectionRepo.save(
      this.connectionRepo.create({
        userId,
        provider: "apple-music",
        status: "connected",
        encryptedAccessToken: this.seal(user.appleMusicUserToken),
        scopes: ["library-read"],
        accountName: "Apple Music account",
      }),
    );
    await this.clearLegacyToken(userId, "appleMusicUserToken");
    return this.findConnection(userId, "apple-music", true);
  }

  async recordSync(
    userId: string,
    provider: MusicProviderName,
    playlistCount?: number,
  ): Promise<void> {
    await this.connectionRepo.update(
      { userId, provider },
      {
        lastSyncedAt: new Date(),
        ...(playlistCount === undefined ? {} : { playlistCount }),
        lastErrorCode: null,
      },
    );
  }

  async requireReauthorization(
    userId: string,
    provider: MusicProviderName,
    code = "PROVIDER_AUTHORIZATION_REJECTED",
  ): Promise<void> {
    const connection = await this.findConnection(userId, provider, true);
    if (connection) await this.markReauthRequired(connection, code);
  }

  async disconnect(userId: string, provider: MusicProviderName): Promise<void> {
    await this.connectionRepo.delete({ userId, provider });
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (user) {
      user.connectedPlatforms = user.connectedPlatforms.filter((entry) => entry !== provider);
      await this.userRepo.save(user);
      await this.clearLegacyToken(
        userId,
        provider === "spotify" ? "spotifyRefreshToken" : "appleMusicUserToken",
      );
    }
    await this.analytics.track("music.account_disconnected", {
      userId,
      properties: { provider },
    });
  }

  private async clearLegacyToken(
    userId: string,
    column: "spotifyRefreshToken" | "appleMusicUserToken",
  ): Promise<void> {
    await this.userRepo
      .createQueryBuilder()
      .update(User)
      .set({ [column]: () => "NULL" } as never)
      .where("id = :userId", { userId })
      .execute();
  }
}
