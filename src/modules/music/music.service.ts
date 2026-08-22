import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import * as jwt from "jsonwebtoken";
import { Repository } from "typeorm";

import { isRedisReady, REDIS_CLIENT } from "../../common/modules/redis.module";
import { User } from "../../entities";
import {
  MusicErrorCode,
  MusicLinkType,
  MusicLookupContext,
  MusicProvider,
  MusicResolutionException,
  UpstreamMusicError,
} from "./music.errors";
import { MusicConnectionsService } from "./music-connections.service";

type RedisClient = any;

export interface ParsedTrack {
  platform: "spotify" | "apple-music";
  title: string;
  artist: string;
  albumArt?: string;
  sourceLink: string;
  durationMs?: number;
}

type ParsedCollection = {
  type: "album" | "playlist";
  name: string;
  tracks: ParsedTrack[];
};

type PreparedMusicLink = MusicLookupContext & {
  rawUrl: string;
  storefront: string | null;
};

interface SpotifyTrack {
  name: string;
  artists: Array<{ name: string }>;
  album?: {
    images: Array<{ url: string }>;
  };
  duration_ms?: number;
}

interface AppleMusicSong {
  attributes?: {
    name: string;
    artistName: string;
    artwork?: {
      url: string;
    };
    durationInMillis?: number;
    url?: string;
  };
  id?: string;
}

type ResilientFetchMeta = {
  operation: string;
  provider: MusicProvider;
  requestId: string;
  retries?: number;
  timeoutMs?: number;
};

const TRACK_CACHE_TTL_SECONDS = 24 * 60 * 60;
const COLLECTION_CACHE_TTL_SECONDS = 10 * 60;
const TRACK_CACHE_PREFIX = "music:track:";
const COLLECTION_CACHE_PREFIX = "music:collection:";
const FETCH_TIMEOUT_MS = 7_000;
const FETCH_MAX_RETRIES = 2;
const FETCH_BACKOFF_MS = 500;

/** Refresh Spotify token this many ms before it actually expires. */
const SPOTIFY_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1_000;
/** Minimum delay before a scheduled token refresh fires. */
const SPOTIFY_TOKEN_REFRESH_MIN_DELAY_MS = 30_000;
/** Delay before retrying a failed background token refresh. */
const SPOTIFY_TOKEN_REFRESH_RETRY_MS = 60_000;
/** Hard deadline for the entire parse-link → provider-lookup pipeline. */
const TOTAL_PARSE_DEADLINE_MS = 18_000;

@Injectable()
export class MusicService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MusicService.name);
  private spotifyAccessToken: string | null = null;
  private spotifyTokenExpiry = 0;
  private appleMusicJwt: string | null = null;
  private appleMusicJwtExpiry = 0;
  private readonly memCache = new Map<string, { data: unknown; expiresAt: number }>();
  private pendingSpotifyToken: Promise<string | null> | null = null;
  private pendingAppleMusicJwt: Promise<string | null> | null = null;
  private readonly pendingTrackLookups = new Map<string, Promise<ParsedTrack>>();
  private readonly pendingCollectionLookups = new Map<string, Promise<ParsedCollection>>();
  private spotifyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private initComplete = false;
  private lastSpotifyTokenRefreshAt = 0;
  private appleMusicJwtIssuedAt = 0;
  private lastAppleMusicTokenRefreshAt = 0;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: RedisClient | null,
    @Optional() private readonly musicConnections?: MusicConnectionsService,
  ) {}

  /* ── Lifecycle ─────────────────────────────────────────────────────── */

  async onModuleInit() {
    if (process.env.REPITAIR_PROCESS_ROLE === "worker") return;
    // Pre-warm Spotify client-credentials token so the first user request
    // does not pay the full token-acquisition cost.
    try {
      const token = await this.getSpotifyAccessToken();
      if (token) {
        this.logger.log("Spotify client token pre-warmed successfully");
        this.scheduleSpotifyTokenRefresh();
      } else {
        this.logger.warn("Spotify client token pre-warm returned null — credentials may be missing");
      }
    } catch (error) {
      this.logger.warn(
        `Spotify token pre-warm error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Pre-generate Apple Music developer JWT (synchronous, but surfaces key errors at boot).
    const applJwt = this.generateAppleMusicJwt();
    if (applJwt) {
      this.logger.log("Apple Music developer JWT pre-generated successfully");
    } else {
      this.logger.warn("Apple Music JWT generation failed — credentials may be missing or key is invalid");
    }

    this.initComplete = true;
  }

  onModuleDestroy() {
    if (this.spotifyRefreshTimer) {
      clearTimeout(this.spotifyRefreshTimer);
      this.spotifyRefreshTimer = null;
    }
  }

  /**
   * Expose token diagnostics for production telemetry.
   * No secrets are included — only timing and state metadata.
   */
  getTokenDiagnostics(provider: MusicProvider): {
    coldStart: boolean;
    tokenAgeMs: number | null;
    lastRefreshAgeMs: number | null;
  } {
    const now = Date.now();
    if (provider === "spotify") {
      const tokenAgeMs = this.spotifyTokenExpiry > 0
        ? now - (this.spotifyTokenExpiry - 3600_000) // approximate acquisition time
        : null;
      return {
        coldStart: !this.initComplete,
        lastRefreshAgeMs: this.lastSpotifyTokenRefreshAt > 0 ? now - this.lastSpotifyTokenRefreshAt : null,
        tokenAgeMs,
      };
    }
    if (provider === "apple-music") {
      return {
        coldStart: !this.initComplete,
        lastRefreshAgeMs: this.lastAppleMusicTokenRefreshAt > 0
          ? now - this.lastAppleMusicTokenRefreshAt
          : null,
        tokenAgeMs: this.appleMusicJwtIssuedAt > 0 ? now - this.appleMusicJwtIssuedAt : null,
      };
    }
    return { coldStart: !this.initComplete, lastRefreshAgeMs: null, tokenAgeMs: null };
  }

  /**
   * Schedule a background refresh of the Spotify token before it expires.
   * Uses the actual expiry from the token response rather than a hardcoded duration.
   */
  private scheduleSpotifyTokenRefresh() {
    if (this.spotifyRefreshTimer) {
      clearTimeout(this.spotifyRefreshTimer);
    }

    const msUntilExpiry = this.spotifyTokenExpiry - Date.now();
    const refreshIn = Math.max(
      msUntilExpiry - SPOTIFY_TOKEN_REFRESH_MARGIN_MS,
      SPOTIFY_TOKEN_REFRESH_MIN_DELAY_MS,
    );

    this.spotifyRefreshTimer = setTimeout(async () => {
      try {
        // Force a fresh token by invalidating the cached one.
        this.invalidateSpotifyToken();
        const token = await this.getSpotifyAccessToken();
        if (token) {
          this.lastSpotifyTokenRefreshAt = Date.now();
          this.logger.log("Spotify token background refresh succeeded");
          this.scheduleSpotifyTokenRefresh();
        } else {
          this.logger.warn("Spotify token background refresh returned null — will retry");
          this.spotifyRefreshTimer = setTimeout(
            () => this.scheduleSpotifyTokenRefresh(),
            SPOTIFY_TOKEN_REFRESH_RETRY_MS,
          );
          this.spotifyRefreshTimer?.unref?.();
        }
      } catch (error) {
        this.logger.warn(
          `Spotify token background refresh error: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.spotifyRefreshTimer = setTimeout(
          () => this.scheduleSpotifyTokenRefresh(),
          SPOTIFY_TOKEN_REFRESH_RETRY_MS,
        );
        this.spotifyRefreshTimer?.unref?.();
      }
    }, refreshIn);

    this.spotifyRefreshTimer.unref();
  }

  /** Clear the cached Spotify token so the next call to getSpotifyAccessToken fetches fresh. */
  private invalidateSpotifyToken() {
    this.spotifyAccessToken = null;
    this.spotifyTokenExpiry = 0;
  }

  /**
   * Race a promise against a hard deadline.
   * Used to guarantee we return before the mobile client times out.
   */
  private withDeadline<T>(promise: Promise<T>, deadlineMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new UpstreamMusicError({
            code: "PROVIDER_TIMEOUT",
            httpStatus: 504,
            message,
            retriable: true,
          }),
        );
      }, deadlineMs);
      timer.unref();
    });

    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
  }

  /**
   * Execute a Spotify API call with automatic 401 recovery.
   * If the provider returns 401, the cached token is invalidated, a fresh token
   * is acquired, and the request is retried exactly once.
   */
  private async spotifyApiCall(
    url: string,
    context: PreparedMusicLink,
    operation: string,
  ): Promise<Response> {
    let token = await this.getSpotifyAccessToken();
    if (!token) {
      throw this.buildResolutionException(context, {
        code: "PROVIDER_AUTH_FAILURE",
        message: "Spotify lookup is not configured right now.",
        retriable: false,
        status: 503,
      });
    }

    const response = await this.resilientFetch(
      url,
      { headers: { Authorization: `Bearer ${token}` } },
      { operation, provider: "spotify", requestId: context.requestId },
    );

    if (response.status === 401) {
      this.logger.warn(`Spotify 401 on ${operation} — invalidating token and retrying once`);
      this.invalidateSpotifyToken();
      token = await this.getSpotifyAccessToken();
      if (token) {
        return this.resilientFetch(
          url,
          { headers: { Authorization: `Bearer ${token}` } },
          { operation: `${operation}-auth-retry`, provider: "spotify", requestId: context.requestId, retries: 0 },
        );
      }
    }

    return response;
  }

  /**
   * Execute an Apple Music API call with automatic provider-auth recovery.
   * If the provider returns 401/403, the cached JWT is invalidated, a fresh JWT
   * is generated, and the request is retried exactly once.
   */
  private async appleMusicApiCall(
    url: string,
    context: PreparedMusicLink,
    operation: string,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const token = this.generateAppleMusicJwt();
    if (!token) {
      throw this.buildResolutionException(context, {
        code: "PROVIDER_AUTH_FAILURE",
        message: "Apple Music lookup is not configured right now.",
        retriable: false,
        status: 503,
      });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    };

    let response = await this.resilientFetch(url, { headers }, {
      operation,
      provider: "apple-music",
      requestId: context.requestId,
    });
    if (response.status === 401 || response.status === 403) {
      this.logger.warn(`Apple Music ${response.status} on ${operation} — regenerating developer JWT and retrying once`);
      this.invalidateAppleMusicToken();
      const freshToken = this.generateAppleMusicJwt();
      if (freshToken) {
        response = await this.resilientFetch(
          url,
          { headers: { ...headers, Authorization: `Bearer ${freshToken}` } },
          { operation: `${operation}-auth-retry`, provider: "apple-music", requestId: context.requestId, retries: 0 },
        );
      }
    }
    if (response.status === 401 && extraHeaders?.["Music-User-Token"] && context.userId && this.musicConnections) {
      await this.musicConnections.requireReauthorization(context.userId, "apple-music");
    }
    return response;
  }

  detectLinkType(link: string): "track" | "album" | "playlist" {
    const normalized = link.toLowerCase();
    if (/spotify\.com\/(?:intl-[a-z]+\/)?album\//.test(normalized)) return "album";
    if (/spotify\.com\/(?:intl-[a-z]+\/)?playlist\//.test(normalized)) return "playlist";
    if (normalized.includes("/song/")) return "track";
    if (normalized.includes("?i=") || normalized.includes("&i=")) return "track";
    if (normalized.includes("/album/")) return "album";
    if (normalized.includes("/playlist/")) return "playlist";
    return "track";
  }

  async prepareLink(rawLink: string, requestId: string, userId?: string): Promise<PreparedMusicLink> {
    const cleaned = this.trimSharedUrl(rawLink);
    let url: URL;

    try {
      url = new URL(cleaned);
    } catch {
      throw this.buildResolutionException(
        {
          endpoint: "/music/parse-link",
          linkType: "unknown",
          normalizedUrl: cleaned,
          provider: "unknown",
          requestId,
          userId,
        },
        {
          code: "INVALID_LINK",
          message: "This doesn’t look like a valid Spotify or Apple Music link.",
          retriable: false,
          status: 400,
        },
      );
    }

    const host = url.hostname.toLowerCase();
    // Exact-host matching: `base` itself or a real subdomain (`.base`). This
    // rejects look-alikes such as `xspotify.com` / `notmusic.apple.com` that a
    // bare endsWith() would accept. (IDs are still only ever used against the
    // hardcoded official API bases, so this is defence-in-depth, not the sole
    // SSRF guard.)
    const hostIs = (base: string) => host === base || host.endsWith(`.${base}`);
    if (host === "spotify.link") {
      const resolvedUrl = await this.resolveSpotifyShortLink(cleaned, requestId);
      return this.prepareLink(resolvedUrl, requestId, userId);
    }

    if (hostIs("spotify.com")) {
      const segments = url.pathname
        .split("/")
        .filter(Boolean)
        .filter((segment) => !segment.startsWith("intl-"));
      const rawKind = segments[0]?.toLowerCase();
      const linkType: MusicLinkType = rawKind === "track" || rawKind === "album" || rawKind === "playlist"
        ? rawKind
        : "unknown";
      const normalizedUrl = linkType === "unknown" ? cleaned : this.normalizeSpotifyUrl(url, linkType, segments);
      if (linkType === "unknown") {
        throw this.buildResolutionException(
          {
            endpoint: "/music/parse-link",
            linkType,
            normalizedUrl,
            provider: "spotify",
            requestId,
            userId,
          },
          {
            code: "INVALID_LINK",
            message: "This doesn’t look like a valid Spotify track, album, or playlist link.",
            retriable: false,
            status: 400,
          },
        );
      }

      return {
        endpoint: "/music/parse-link",
        linkType,
        normalizedUrl,
        provider: "spotify",
        rawUrl: cleaned,
        requestId,
        storefront: null,
        userId,
      };
    }

    if (hostIs("music.apple.com") || hostIs("itunes.apple.com")) {
      const lowerSegments = url.pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
      const linkType: MusicLinkType = lowerSegments.includes("playlist")
        ? "playlist"
        : lowerSegments.includes("song") || url.searchParams.has("i")
          ? "track"
          : lowerSegments.includes("album")
            ? "album"
            : "unknown";
      const normalizedUrl = this.normalizeAppleUrl(url);
      if (linkType === "unknown") {
        throw this.buildResolutionException(
          {
            endpoint: "/music/parse-link",
            linkType,
            normalizedUrl,
            provider: "apple-music",
            requestId,
            userId,
          },
          {
            code: "INVALID_LINK",
            message: "This doesn’t look like a valid Apple Music song, album, or playlist link.",
            retriable: false,
            status: 400,
          },
        );
      }

      return {
        endpoint: "/music/parse-link",
        linkType,
        normalizedUrl,
        provider: "apple-music",
        rawUrl: cleaned,
        requestId,
        storefront: this.extractAppleMusicStorefront(normalizedUrl),
        userId,
      };
    }

    throw this.buildResolutionException(
      {
        endpoint: "/music/parse-link",
        linkType: "unknown",
        normalizedUrl: cleaned,
        provider: "unknown",
        requestId,
        userId,
      },
      {
        code: "UNSUPPORTED_PROVIDER_URL",
        message: "This doesn’t look like a valid Spotify or Apple Music link.",
        retriable: false,
        status: 400,
      },
    );
  }

  async listAlbumTracks(link: string, userId?: string, requestId = "server"): Promise<ParsedCollection> {
    return this.withDeadline(
      (async () => {
        const prepared = await this.prepareLink(link, requestId, userId);
        return this.listPreparedCollection(prepared);
      })(),
      TOTAL_PARSE_DEADLINE_MS,
      `Collection lookup exceeded ${TOTAL_PARSE_DEADLINE_MS}ms deadline`,
    );
  }

  async parseLink(link: string, requestId = "server"): Promise<ParsedTrack> {
    return this.withDeadline(
      (async () => {
        const prepared = await this.prepareLink(link, requestId);
        return this.parsePreparedTrack(prepared);
      })(),
      TOTAL_PARSE_DEADLINE_MS,
      `Track lookup exceeded ${TOTAL_PARSE_DEADLINE_MS}ms deadline`,
    );
  }

  async search(
    query: string,
    platform: "spotify" | "apple-music" = "spotify",
    storefront = "us",
  ): Promise<ParsedTrack[]> {
    if (!query?.trim()) return [];

    if (platform === "apple-music") {
      return this.searchAppleMusic(query, storefront);
    }

    const token = await this.getSpotifyAccessToken();
    if (!token) return [];

    try {
      const params = new URLSearchParams({
        limit: "10",
        q: query,
        type: "track",
      });
      const response = await this.resilientFetch(
        `https://api.spotify.com/v1/search?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        {
          operation: "spotify-search",
          provider: "spotify",
          requestId: "search",
        },
      );

      if (!response.ok) return [];

      const data = await response.json() as {
        tracks?: {
          items: Array<SpotifyTrack & { id: string; duration_ms: number }>;
        };
      };

      return (data.tracks?.items ?? []).map((track) => ({
        albumArt: track.album?.images?.[0]?.url,
        artist: track.artists.map((artist) => artist.name).join(", "),
        durationMs: track.duration_ms,
        platform: "spotify" as const,
        sourceLink: `https://open.spotify.com/track/${track.id}`,
        title: track.name,
      }));
    } catch {
      return [];
    }
  }

  async getRecentSongs(userId?: string): Promise<ParsedTrack[]> {
    if (!userId) return [];

    const token = await this.getUserSpotifyAccessToken(userId);
    if (!token) return [];

    try {
      const response = await this.resilientFetch(
        "https://api.spotify.com/v1/me/player/recently-played?limit=10",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        {
          operation: "spotify-recent-songs",
          provider: "spotify",
          requestId: `recent-${userId}`,
        },
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as {
        items?: Array<{
          track: SpotifyTrack & { id: string; duration_ms?: number };
        }>;
      };

      return (data.items ?? []).map(({ track }) => ({
        albumArt: track.album?.images?.[0]?.url,
        artist: track.artists.map((artist) => artist.name).join(", "),
        durationMs: track.duration_ms,
        platform: "spotify" as const,
        sourceLink: `https://open.spotify.com/track/${track.id}`,
        title: track.name,
      }));
    } catch {
      return [];
    }
  }

  isPersonalPlaylist(link: string): boolean {
    const playlistId = this.extractAppleMusicPlaylistId(link);
    return playlistId?.startsWith("pl.u-") ?? false;
  }

  private trimSharedUrl(raw: string) {
    return raw.trim().replace(/[.,;:!?)}\]]+$/, "");
  }

  private normalizeSpotifyUrl(url: URL, linkType: "track" | "album" | "playlist", filteredSegments?: string[]) {
    const segments = filteredSegments ?? url.pathname.split("/").filter(Boolean).filter((segment) => !segment.startsWith("intl-"));
    const id = segments[1];
    if (!id) return url.toString();
    return `https://open.spotify.com/${linkType}/${id}`;
  }

  private normalizeAppleUrl(url: URL) {
    const keep = new URLSearchParams();
    const trackId = url.searchParams.get("i");
    if (trackId) {
      keep.set("i", trackId);
    }
    const query = keep.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  }

  private normalizeCacheKey(key: string) {
    return Buffer.from(key).toString("base64url");
  }

  private async getCached<T>(prefix: string, key: string): Promise<T | null> {
    const fullKey = prefix + this.normalizeCacheKey(key);
    if (isRedisReady(this.redis)) {
      try {
        const raw = await this.redis.get(fullKey);
        if (raw) return JSON.parse(raw) as T;
      } catch {
        // Fall back to in-memory cache.
      }
    }

    const entry = this.memCache.get(fullKey);
    if (entry && Date.now() < entry.expiresAt) {
      return entry.data as T;
    }
    if (entry) {
      this.memCache.delete(fullKey);
    }
    return null;
  }

  private async setCache<T>(prefix: string, key: string, data: T, ttlSeconds: number): Promise<void> {
    const fullKey = prefix + this.normalizeCacheKey(key);
    if (isRedisReady(this.redis)) {
      try {
        await this.redis.setex(fullKey, ttlSeconds, JSON.stringify(data));
        return;
      } catch {
        // Fall back to in-memory cache.
      }
    }

    this.memCache.set(fullKey, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  private async resolveSpotifyShortLink(shortUrl: string, requestId: string): Promise<string> {
    const response = await this.resilientFetch(
      shortUrl,
      {
        method: "GET",
        redirect: "follow",
      },
      {
        operation: "spotify-short-link",
        provider: "spotify",
        requestId,
        retries: 1,
        timeoutMs: 4_000,
      },
    );

    if (!response.ok) {
      throw this.buildResolutionException(
        {
          endpoint: "/music/parse-link",
          linkType: "unknown",
          normalizedUrl: shortUrl,
          provider: "spotify",
          requestId,
        },
        this.mapResponseToError(response, "We couldn’t resolve that Spotify short link."),
      );
    }

    if (!response.url || response.url === shortUrl) {
      throw this.buildResolutionException(
        {
          endpoint: "/music/parse-link",
          linkType: "unknown",
          normalizedUrl: shortUrl,
          provider: "spotify",
          requestId,
        },
        {
          code: "NORMALIZATION_FAILURE",
          message: "We couldn’t resolve that Spotify short link. Copy the full Spotify link and try again.",
          retriable: false,
          status: 400,
        },
      );
    }

    return response.url;
  }

  private async dedupeLookup<T>(
    store: Map<string, Promise<T>>,
    key: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const existing = store.get(key);
    if (existing) {
      return existing;
    }

    const pending = loader().finally(() => {
      store.delete(key);
    });
    store.set(key, pending);
    return pending;
  }

  private logLookup(
    level: "log" | "warn" | "error",
    message: string,
    context: MusicLookupContext,
    extra: Record<string, unknown> = {},
  ) {
    const payload = {
      endpoint: context.endpoint,
      linkType: context.linkType,
      message,
      normalizedUrl: context.normalizedUrl,
      provider: context.provider,
      requestId: context.requestId,
      userId: context.userId ?? null,
      ...extra,
    };

    if (level === "error") {
      console.error(JSON.stringify(payload));
      return;
    }

    console[level](JSON.stringify(payload));
  }

  private parseRetryAfterSeconds(response: Response) {
    const raw = response.headers.get("retry-after");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async resilientFetch(
    url: string,
    options: RequestInit = {},
    meta: ResilientFetchMeta,
  ): Promise<Response> {
    const retries = meta.retries ?? FETCH_MAX_RETRIES;
    const timeoutMs = meta.timeoutMs ?? FETCH_TIMEOUT_MS;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const startedAt = Date.now();

      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const durationMs = Date.now() - startedAt;

        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
          return response;
        }

        const shouldRetry = attempt < retries && (response.status === 429 || response.status >= 500);
        const retryAfterSeconds = this.parseRetryAfterSeconds(response);
        if (shouldRetry) {
          const delayMs = retryAfterSeconds
            ? retryAfterSeconds * 1000
            : FETCH_BACKOFF_MS * Math.pow(2, attempt);
          console.warn(JSON.stringify({
            attempt: attempt + 1,
            durationMs,
            message: "Retrying upstream music request",
            operation: meta.operation,
            provider: meta.provider,
            providerStatus: response.status,
            requestId: meta.requestId,
            retryAfterSeconds,
            timeoutMs,
          }));
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        const durationMs = Date.now() - startedAt;
        const isAbort = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
        if (attempt < retries) {
          const delayMs = FETCH_BACKOFF_MS * Math.pow(2, attempt);
          console.warn(JSON.stringify({
            attempt: attempt + 1,
            durationMs,
            message: "Retrying upstream music request after fetch error",
            operation: meta.operation,
            provider: meta.provider,
            requestId: meta.requestId,
            timeoutMs,
            upstreamError: error instanceof Error ? error.message : String(error),
          }));
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        throw new UpstreamMusicError({
          code: isAbort ? "PROVIDER_TIMEOUT" : "NETWORK_FAILURE",
          httpStatus: isAbort ? 504 : 503,
          message: isAbort
            ? "The music service is taking too long. Try again."
            : "We couldn’t reach the music provider right now. Please try again.",
          retriable: true,
        });
      }
    }

    throw new UpstreamMusicError({
      code: "UNKNOWN_RESOLUTION_FAILURE",
      httpStatus: 502,
      message: "We couldn’t load music details right now. Please try again.",
      retriable: true,
    });
  }

  private buildResolutionException(
    context: MusicLookupContext,
    args: {
      code: MusicErrorCode;
      message: string;
      providerStatus?: number | null;
      retriable?: boolean;
      status: number;
    },
  ) {
    return new MusicResolutionException({
      code: args.code,
      context,
      message: args.message,
      providerStatus: args.providerStatus,
      retriable: args.retriable,
      status: args.status,
    });
  }

  private mapResponseToError(response: Response, fallbackMessage: string) {
    switch (response.status) {
      case 401:
      case 403:
        return {
          code: "PROVIDER_AUTH_FAILURE" as const,
          message: "Music provider access is unavailable right now. Please reconnect and try again.",
          providerStatus: response.status,
          retriable: false,
          status: 503,
        };
      case 404:
        return {
          code: "PROVIDER_NOT_FOUND" as const,
          message: "We couldn’t find music details for this link.",
          providerStatus: response.status,
          retriable: false,
          status: 404,
        };
      case 429:
        return {
          code: "PROVIDER_RATE_LIMIT" as const,
          message: "Music lookup is temporarily busy. Please try again shortly.",
          providerStatus: response.status,
          retriable: true,
          status: 429,
        };
      case 408:
        return {
          code: "PROVIDER_TIMEOUT" as const,
          message: "The music service is taking too long. Try again.",
          providerStatus: response.status,
          retriable: true,
          status: 504,
        };
      default:
        return response.status >= 500
          ? {
              code: "PROVIDER_UNAVAILABLE" as const,
              message: "The music service is temporarily unavailable. Please try again.",
              providerStatus: response.status,
              retriable: true,
              status: 503,
            }
          : {
              code: "UNKNOWN_RESOLUTION_FAILURE" as const,
              message: fallbackMessage,
              providerStatus: response.status,
              retriable: false,
              status: 400,
            };
    }
  }

  private toResolutionException(
    error: unknown,
    context: MusicLookupContext,
    fallbackMessage: string,
  ) {
    if (error instanceof MusicResolutionException) {
      return error;
    }

    if (error instanceof UpstreamMusicError) {
      return this.buildResolutionException(context, {
        code: error.code,
        message: error.message,
        providerStatus: error.providerStatus,
        retriable: error.retriable,
        status: error.httpStatus,
      });
    }

    return this.buildResolutionException(context, {
      code: "UNKNOWN_RESOLUTION_FAILURE",
      message: fallbackMessage,
      retriable: true,
      status: 503,
    });
  }

  private async parsePreparedTrack(prepared: PreparedMusicLink): Promise<ParsedTrack> {
    if (prepared.linkType !== "track") {
      throw this.buildResolutionException(prepared, {
        code: "INVALID_LINK",
        message: "This link is not a single track.",
        retriable: false,
        status: 400,
      });
    }

    const cached = await this.getCached<ParsedTrack>(TRACK_CACHE_PREFIX, prepared.normalizedUrl);
    if (cached) {
      this.logLookup("log", "Music track cache hit", prepared);
      return cached;
    }

    return this.dedupeLookup(this.pendingTrackLookups, prepared.normalizedUrl, async () => {
      const startedAt = Date.now();
      try {
        let track: ParsedTrack | null = null;

        if (prepared.provider === "spotify") {
          const trackId = this.extractSpotifyTrackId(prepared.normalizedUrl);
          if (!trackId) {
            throw this.buildResolutionException(prepared, {
              code: "NORMALIZATION_FAILURE",
              message: "We couldn’t extract the Spotify track ID from that link.",
              retriable: false,
              status: 400,
            });
          }
          track = await this.lookupSpotifyTrack(trackId, prepared);
        } else if (prepared.provider === "apple-music") {
          const trackId = this.extractAppleMusicTrackId(prepared.normalizedUrl);
          if (!trackId) {
            throw this.buildResolutionException(prepared, {
              code: "NORMALIZATION_FAILURE",
              message: "We couldn’t extract the Apple Music song ID from that link.",
              retriable: false,
              status: 400,
            });
          }
          track = await this.lookupAppleMusicTrack(trackId, prepared);
        }

        if (!track) {
          throw this.buildResolutionException(prepared, {
            code: "PROVIDER_NOT_FOUND",
            message: "We couldn’t find music details for this link.",
            retriable: false,
            status: 404,
          });
        }

        await this.setCache(TRACK_CACHE_PREFIX, prepared.normalizedUrl, track, TRACK_CACHE_TTL_SECONDS);
        this.logLookup("log", "Music track lookup succeeded", prepared, {
          durationMs: Date.now() - startedAt,
          responseType: "track",
        });
        return track;
      } catch (error) {
        const resolved = this.toResolutionException(
          error,
          prepared,
          "We couldn’t load that song right now. Please try again.",
        );
        this.logLookup("warn", "Music track lookup failed", prepared, {
          durationMs: Date.now() - startedAt,
          errorCode: resolved.code,
          providerStatus: resolved.providerStatus,
          retriable: resolved.retriable,
          statusCode: resolved.getStatus(),
        });
        throw resolved;
      }
    });
  }

  private async listPreparedCollection(prepared: PreparedMusicLink): Promise<ParsedCollection> {
    if (prepared.linkType !== "album" && prepared.linkType !== "playlist") {
      throw this.buildResolutionException(prepared, {
        code: "INVALID_LINK",
        message: "This link does not point to an album or playlist.",
        retriable: false,
        status: 400,
      });
    }

    const collectionLookupKey = prepared.linkType === "playlist" && prepared.userId
      ? `user:${prepared.userId}:${prepared.normalizedUrl}`
      : `public:${prepared.normalizedUrl}`;
    const cached = await this.getCached<ParsedCollection>(COLLECTION_CACHE_PREFIX, collectionLookupKey);
    if (cached) {
      this.logLookup("log", "Music collection cache hit", prepared, {
        responseType: cached.type,
        trackCount: cached.tracks.length,
      });
      return cached;
    }

    return this.dedupeLookup(this.pendingCollectionLookups, collectionLookupKey, async () => {
      const startedAt = Date.now();
      try {
        let result: ParsedCollection | null = null;

        if (prepared.provider === "spotify") {
          if (prepared.linkType === "album") {
            const albumId = this.extractSpotifyAlbumId(prepared.normalizedUrl);
            if (!albumId) {
              throw this.buildResolutionException(prepared, {
                code: "NORMALIZATION_FAILURE",
                message: "We couldn’t extract the Spotify album ID from that link.",
                retriable: false,
                status: 400,
              });
            }
            result = await this.listSpotifyAlbum(albumId, prepared);
          } else {
            const playlistId = this.extractSpotifyPlaylistId(prepared.normalizedUrl);
            if (!playlistId) {
              throw this.buildResolutionException(prepared, {
                code: "NORMALIZATION_FAILURE",
                message: "We couldn’t extract the Spotify playlist ID from that link.",
                retriable: false,
                status: 400,
              });
            }
            result = await this.listSpotifyPlaylist(playlistId, prepared);
          }
        } else if (prepared.provider === "apple-music") {
          if (prepared.linkType === "album") {
            const albumId = this.extractAppleMusicAlbumId(prepared.normalizedUrl);
            if (!albumId) {
              throw this.buildResolutionException(prepared, {
                code: "NORMALIZATION_FAILURE",
                message: "We couldn’t extract the Apple Music album ID from that link.",
                retriable: false,
                status: 400,
              });
            }
            result = await this.listAppleMusicAlbum(albumId, prepared);
          } else {
            const playlistId = this.extractAppleMusicPlaylistId(prepared.normalizedUrl);
            if (!playlistId) {
              throw this.buildResolutionException(prepared, {
                code: "NORMALIZATION_FAILURE",
                message: "We couldn’t extract the Apple Music playlist ID from that link.",
                retriable: false,
                status: 400,
              });
            }
            result = await this.listAppleMusicPlaylist(playlistId, prepared);
          }
        }

        if (!result || !Array.isArray(result.tracks) || result.tracks.length === 0) {
          throw this.buildResolutionException(prepared, {
            code: "PROVIDER_NOT_FOUND",
            message: `We couldn’t load tracks from that ${prepared.provider === "spotify" ? "Spotify" : "Apple Music"} ${prepared.linkType}.`,
            retriable: false,
            status: 404,
          });
        }

        await this.setCache(COLLECTION_CACHE_PREFIX, collectionLookupKey, result, COLLECTION_CACHE_TTL_SECONDS);
        this.logLookup("log", "Music collection lookup succeeded", prepared, {
          durationMs: Date.now() - startedAt,
          responseType: result.type,
          trackCount: result.tracks.length,
        });
        return result;
      } catch (error) {
        const resolved = this.toResolutionException(
          error,
          prepared,
          `We couldn’t load tracks from that ${prepared.provider === "spotify" ? "Spotify" : "Apple Music"} ${prepared.linkType}.`,
        );
        this.logLookup("warn", "Music collection lookup failed", prepared, {
          durationMs: Date.now() - startedAt,
          errorCode: resolved.code,
          providerStatus: resolved.providerStatus,
          retriable: resolved.retriable,
          statusCode: resolved.getStatus(),
        });
        throw resolved;
      }
    });
  }

  private isSpotifyLink(link: string) {
    return link.includes("spotify.com");
  }

  private isAppleMusicLink(link: string) {
    return link.includes("music.apple.com") || link.includes("itunes.apple.com");
  }

  private async getSpotifyAccessToken(): Promise<string | null> {
    if (this.spotifyAccessToken && Date.now() < this.spotifyTokenExpiry) {
      return this.spotifyAccessToken;
    }

    if (this.pendingSpotifyToken) {
      return this.pendingSpotifyToken;
    }

    this.pendingSpotifyToken = this.fetchSpotifyToken();
    try {
      return await this.pendingSpotifyToken;
    } finally {
      this.pendingSpotifyToken = null;
    }
  }

  private async fetchSpotifyToken(): Promise<string | null> {
    const clientId = this.configService.get<string>("SPOTIFY_CLIENT_ID");
    const clientSecret = this.configService.get<string>("SPOTIFY_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return null;
    }

    try {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const response = await this.resilientFetch(
        "https://accounts.spotify.com/api/token",
        {
          body: "grant_type=client_credentials",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        {
          operation: "spotify-client-token",
          provider: "spotify",
          requestId: "spotify-client-token",
        },
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { access_token: string; expires_in: number };
      this.spotifyAccessToken = data.access_token;
      this.spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      return this.spotifyAccessToken;
    } catch {
      return null;
    }
  }

  private async getUserSpotifyAccessToken(userId: string): Promise<string | null> {
    if (this.musicConnections) {
      try {
        return await this.musicConnections.spotifyAccessToken(userId);
      } catch {
        return null;
      }
    }
    const clientId = this.configService.get<string>("SPOTIFY_CLIENT_ID");
    const clientSecret = this.configService.get<string>("SPOTIFY_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return null;
    }

    const user = await this.usersRepo
      .createQueryBuilder("user")
      .addSelect("user.spotifyRefreshToken")
      .where("user.id = :userId", { userId })
      .getOne();

    const refreshToken = user?.spotifyRefreshToken;
    if (!refreshToken) {
      return null;
    }

    try {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const response = await this.resilientFetch(
        "https://accounts.spotify.com/api/token",
        {
          body: body.toString(),
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        {
          operation: "spotify-user-token",
          provider: "spotify",
          requestId: `spotify-user-token:${userId}`,
        },
      );

      if (!response.ok) {
        if (response.status === 400 || response.status === 401) {
          await this.usersRepo.update(userId, { spotifyRefreshToken: undefined });
        }
        return null;
      }

      const data = await response.json() as { access_token?: string; refresh_token?: string };
      if (data.refresh_token && data.refresh_token !== refreshToken) {
        await this.usersRepo.update(userId, { spotifyRefreshToken: data.refresh_token });
      }
      return data.access_token ?? null;
    } catch {
      return null;
    }
  }

  async getUserAppleMusicToken(userId: string): Promise<string | null> {
    if (this.musicConnections) {
      try {
        return await this.musicConnections.appleMusicUserToken(userId);
      } catch {
        return null;
      }
    }
    const user = await this.usersRepo
      .createQueryBuilder("user")
      .addSelect("user.appleMusicUserToken")
      .where("user.id = :id", { id: userId })
      .getOne();
    return user?.appleMusicUserToken ?? null;
  }

  private generateAppleMusicJwt(): string | null {
    if (this.appleMusicJwt && Date.now() < this.appleMusicJwtExpiry) {
      return this.appleMusicJwt;
    }

    if (this.pendingAppleMusicJwt) {
      return null;
    }

    const teamId = this.configService.get<string>("APPLE_MUSIC_TEAM_ID");
    const keyId = this.configService.get<string>("APPLE_MUSIC_KEY_ID");
    const privateKeyStr = this.configService.get<string>("APPLE_MUSIC_PRIVATE_KEY");

    if (!teamId || !keyId || !privateKeyStr) {
      return null;
    }

    try {
      const privateKey = privateKeyStr.replace(/\\n/g, "\n");
      const token = jwt.sign({}, privateKey, {
        algorithm: "ES256",
        expiresIn: "180d",
        header: {
          alg: "ES256",
          kid: keyId,
        },
        issuer: teamId,
      });

      this.appleMusicJwt = token;
      this.appleMusicJwtExpiry = Date.now() + 179 * 24 * 60 * 60 * 1000;
      this.appleMusicJwtIssuedAt = Date.now();
      this.lastAppleMusicTokenRefreshAt = this.appleMusicJwtIssuedAt;
      return token;
    } catch {
      return null;
    }
  }

  private invalidateAppleMusicToken() {
    this.appleMusicJwt = null;
    this.appleMusicJwtExpiry = 0;
    this.appleMusicJwtIssuedAt = 0;
  }

  private extractSpotifyTrackId(url: string) {
    const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  private extractSpotifyAlbumId(url: string) {
    const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?album\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  private extractSpotifyPlaylistId(url: string) {
    const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  private extractAppleMusicStorefront(url: string) {
    const match = url.match(/(?:music|itunes)\.apple\.com\/([a-z]{2})\//);
    return match ? match[1] : "us";
  }

  private buildAppleMusicArtworkUrl(url?: string, size = 600) {
    if (!url) return undefined;
    return url.replace("{w}", String(size)).replace("{h}", String(size));
  }

  private extractAppleMusicTrackId(url: string) {
    const paramMatch = url.match(/[?&]i=([0-9]+)/);
    if (paramMatch) return paramMatch[1];

    const songWithName = url.match(/(?:music|itunes)\.apple\.com\/[a-z]{2}\/song\/[^/]+\/(\d+)/);
    if (songWithName) return songWithName[1];

    const songDirect = url.match(/(?:music|itunes)\.apple\.com\/[a-z]{2}\/song\/(\d+)(?:[/?]|$)/);
    if (songDirect) return songDirect[1];

    // Modern storefront-less canonical share links: music.apple.com/song/{id}
    // (and the rarer name variant music.apple.com/song/{name}/{id}).
    const songNoStorefront = url.match(/(?:music|itunes)\.apple\.com\/song\/(?:[^/]+\/)?(\d+)(?:[/?]|$)/);
    return songNoStorefront ? songNoStorefront[1] : null;
  }

  private extractAppleMusicPlaylistId(url: string) {
    const match = url.match(/(?:music|itunes)\.apple\.com\/[a-z]{2}\/playlist\/[^/]+\/([a-zA-Z0-9._-]+)/);
    return match ? match[1] : null;
  }

  private extractAppleMusicAlbumId(url: string) {
    if (url.includes("?i=") || url.includes("&i=")) return null;
    const match = url.match(/(?:music|itunes)\.apple\.com\/[a-z]{2}\/album\/[^/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  private async lookupSpotifyTrack(trackId: string, context: PreparedMusicLink): Promise<ParsedTrack | null> {
    const response = await this.spotifyApiCall(
      `https://api.spotify.com/v1/tracks/${trackId}`,
      context,
      "spotify-track-lookup",
    );

    if (!response.ok) {
      throw this.buildResolutionException(
        context,
        this.mapResponseToError(response, "We couldn’t load that Spotify track right now."),
      );
    }

    const track = await response.json() as SpotifyTrack;
    return {
      albumArt: track.album?.images?.[0]?.url,
      artist: track.artists.map((artist) => artist.name).join(", "),
      durationMs: track.duration_ms,
      platform: "spotify",
      sourceLink: `https://open.spotify.com/track/${trackId}`,
      title: track.name,
    };
  }

  private async lookupAppleMusicTrack(trackId: string, context: PreparedMusicLink): Promise<ParsedTrack | null> {
    const storefront = context.storefront ?? "us";
    const response = await this.appleMusicApiCall(
      `https://api.music.apple.com/v1/catalog/${storefront}/songs/${trackId}`,
      context,
      "apple-track-lookup",
    );

    if (!response.ok) {
      throw this.buildResolutionException(
        context,
        this.mapResponseToError(response, "We couldn’t load that Apple Music song right now."),
      );
    }

    const data = await response.json() as { data?: AppleMusicSong[] };
    const song = data.data?.[0];
    if (!song?.attributes) {
      return null;
    }

    return {
      albumArt: this.buildAppleMusicArtworkUrl(song.attributes.artwork?.url),
      artist: song.attributes.artistName,
      durationMs: song.attributes.durationInMillis,
      platform: "apple-music",
      sourceLink: `https://music.apple.com/${storefront}/song/${trackId}`,
      title: song.attributes.name,
    };
  }

  private async listSpotifyAlbum(albumId: string, context: PreparedMusicLink): Promise<ParsedCollection | null> {
    const response = await this.spotifyApiCall(
      `https://api.spotify.com/v1/albums/${albumId}`,
      context,
      "spotify-album-lookup",
    );

    if (!response.ok) {
      throw this.buildResolutionException(
        context,
        this.mapResponseToError(response, "We couldn’t load that Spotify album right now."),
      );
    }

    const data = await response.json() as {
      images: Array<{ url: string }>;
      name: string;
      tracks: { items: Array<{ artists: Array<{ name: string }>; duration_ms: number; id: string; name: string }> };
    };

    const albumArt = data.images?.[0]?.url;
    return {
      name: data.name,
      tracks: data.tracks.items.map((track) => ({
        albumArt,
        artist: track.artists.map((artist) => artist.name).join(", "),
        durationMs: track.duration_ms,
        platform: "spotify" as const,
        sourceLink: `https://open.spotify.com/track/${track.id}`,
        title: track.name,
      })),
      type: "album",
    };
  }

  private async listSpotifyPlaylist(playlistId: string, context: PreparedMusicLink): Promise<ParsedCollection | null> {
    const url = `https://api.spotify.com/v1/playlists/${playlistId}`;

    // Try user token first if available.
    let usedUserToken = false;
    let userTokenAvailable = false;
    let userTokenStatus: number | null = null;
    if (context.userId) {
      const userToken = await this.getUserSpotifyAccessToken(context.userId);
      if (userToken) {
        usedUserToken = true;
        userTokenAvailable = true;
        const userResponse = await this.resilientFetch(
          url,
          { headers: { Authorization: `Bearer ${userToken}` } },
          { operation: "spotify-playlist-lookup-user-token", provider: "spotify", requestId: context.requestId },
        );
        userTokenStatus = userResponse.status;
        if (userResponse.ok) {
          return this.parseSpotifyPlaylistResponse(userResponse);
        }
        if (userResponse.status === 401 && this.musicConnections) {
          await this.musicConnections.requireReauthorization(context.userId, "spotify");
        }
        // Fall through to client-credentials if user token fails.
      }
    }

    // Client-credentials path with 401 recovery.
    const response = await this.spotifyApiCall(url, context, "spotify-playlist-lookup");

    // Spotify returns 404 (not 403) for private playlists accessed via client credentials.
    // Try the user’s OAuth token as a fallback for both 403 and 404.
    if ((response.status === 403 || response.status === 404) && context.userId && !usedUserToken) {
      const userToken = await this.getUserSpotifyAccessToken(context.userId);
      if (userToken) {
        const retryResponse = await this.resilientFetch(
          url,
          { headers: { Authorization: `Bearer ${userToken}` } },
          { operation: "spotify-playlist-lookup-user-token", provider: "spotify", requestId: context.requestId },
        );
        if (retryResponse.ok) {
          return this.parseSpotifyPlaylistResponse(retryResponse);
        }
      }
    }

    if (!response.ok) {
      this.logger.warn(
        `Spotify playlist lookup failed: playlistId=${playlistId} status=${response.status} ` +
        `userTokenAvailable=${userTokenAvailable} usedUserToken=${usedUserToken} ` +
        `requestId=${context.requestId}`,
      );
      // If Spotify returned 404 and we had no user token to try, the playlist is likely
      // private or personal. Provide an actionable message.
      if (response.status === 404 || userTokenStatus === 404) {
        // A private/personal playlist. Distinguish "no Spotify connection at all"
        // (→ prompt the user to connect, and the client can auto-resume after) from
        // "connected but this account can't access it" (→ terminal access-denied).
        if (!userTokenAvailable) {
          throw this.buildResolutionException(context, {
            code: "PROVIDER_NOT_CONNECTED" as const,
            message: "Connect Spotify to access this playlist.",
            providerStatus: 404,
            retriable: false,
            status: 409,
          });
        }
        throw this.buildResolutionException(context, {
          code: "PROVIDER_NOT_FOUND" as const,
          message: "This playlist can’t be imported. Spotify only lets apps read playlists you created or public playlists — private playlists owned by others and Spotify‑curated/algorithmic playlists (like Discover Weekly) aren’t accessible. Try one of your own playlists.",
          providerStatus: 404,
          retriable: false,
          status: 404,
        });
      }
      throw this.buildResolutionException(
        context,
        this.mapResponseToError(response, "We couldn’t load that Spotify playlist right now."),
      );
    }

    return this.parseSpotifyPlaylistResponse(response);
  }

  private async parseSpotifyPlaylistResponse(response: Response): Promise<ParsedCollection> {
    const data = await response.json() as {
      name: string;
      tracks: { items: Array<{ track: { album?: { images?: Array<{ url: string }> }; artists: Array<{ name: string }>; duration_ms: number; id: string; name: string } | null }> };
    };

    // Playlists can contain podcast episodes and local/unavailable items whose
    // `track` is truthy but has no `id`/`artists` — accessing `.artists.map` on
    // those threw a TypeError that surfaced as a generic 503. Only keep real
    // songs and null-safe every field.
    const items = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
    return {
      name: data?.name ?? "Playlist",
      tracks: items
        .filter((item) => item.track && item.track.id && Array.isArray(item.track.artists))
        .map((item) => ({
          albumArt: item.track?.album?.images?.[0]?.url,
          artist: (item.track!.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", ") || "Unknown artist",
          durationMs: item.track!.duration_ms,
          platform: "spotify" as const,
          sourceLink: `https://open.spotify.com/track/${item.track!.id}`,
          title: item.track!.name ?? "Untitled track",
        })),
      type: "playlist",
    };
  }

  private async listAppleMusicAlbum(albumId: string, context: PreparedMusicLink): Promise<ParsedCollection | null> {
    const storefront = context.storefront ?? "us";
    const response = await this.appleMusicApiCall(
      `https://api.music.apple.com/v1/catalog/${storefront}/albums/${albumId}?include=tracks`,
      context,
      "apple-album-lookup",
    );

    if (!response.ok) {
      throw this.buildResolutionException(
        context,
        this.mapResponseToError(response, "We couldn’t load that Apple Music album right now."),
      );
    }

    const data = await response.json() as {
      data?: Array<{
        attributes?: { artwork?: { url: string }; name: string };
        relationships?: {
          tracks?: {
            data?: Array<{
              attributes?: { artistName: string; durationInMillis?: number; name: string };
              id: string;
            }>;
          };
        };
      }>;
    };

    const album = data.data?.[0];
    if (!album?.attributes) {
      return null;
    }

    const albumArt = this.buildAppleMusicArtworkUrl(album.attributes.artwork?.url);
    const tracks = album.relationships?.tracks?.data ?? [];
    return {
      name: album.attributes.name,
      tracks: tracks
        .filter((track) => track.attributes)
        .map((track) => ({
          albumArt,
          artist: track.attributes!.artistName,
          durationMs: track.attributes!.durationInMillis,
          platform: "apple-music" as const,
          sourceLink: `https://music.apple.com/${storefront}/song/${track.id}`,
          title: track.attributes!.name,
        })),
      type: "album",
    };
  }

  private async listAppleMusicPlaylist(playlistId: string, context: PreparedMusicLink): Promise<ParsedCollection | null> {
    const storefront = context.storefront ?? "us";
    const isPersonal = playlistId.startsWith("pl.u-") || playlistId.startsWith("p.");
    let apiUrl: string;
    let extraHeaders: Record<string, string> | undefined;

    if (isPersonal) {
      const userToken = context.userId ? await this.getUserAppleMusicToken(context.userId) : null;
      if (!userToken) {
        // No Apple Music connection → prompt connect (client can auto-resume after).
        throw this.buildResolutionException(context, {
          code: "PROVIDER_NOT_CONNECTED",
          message: "Connect Apple Music to access this playlist.",
          retriable: false,
          status: 409,
        });
      }
      extraHeaders = { "Music-User-Token": userToken };
      const libraryId = playlistId.startsWith("p.")
        ? playlistId
        : await this.findAppleLibraryPlaylistId(playlistId, context, extraHeaders);
      if (!libraryId) {
        throw this.buildResolutionException(context, {
          code: "PROVIDER_NOT_FOUND",
          message: "This playlist is private. Connect the account that owns it or ask the owner to share it through Repitair.",
          providerStatus: 404,
          retriable: false,
          status: 404,
        });
      }
      apiUrl = `https://api.music.apple.com/v1/me/library/playlists/${encodeURIComponent(libraryId)}?include=tracks`;
    } else {
      apiUrl = `https://api.music.apple.com/v1/catalog/${storefront}/playlists/${playlistId}?include=tracks`;
    }

    const response = await this.appleMusicApiCall(
      apiUrl,
      context,
      "apple-playlist-lookup",
      extraHeaders,
    );

    if (!response.ok) {
      throw this.buildResolutionException(
        context,
        this.mapResponseToError(response, "We couldn’t load that Apple Music playlist right now."),
      );
    }

    const data = await response.json() as {
      data?: Array<{
        attributes?: { artwork?: { url: string }; name: string };
        relationships?: {
          tracks?: {
            data?: Array<{
              attributes?: { artistName: string; artwork?: { url: string }; durationInMillis?: number; name: string };
              id: string;
            }>;
          };
        };
      }>;
    };

    const playlist = data.data?.[0];
    if (!playlist?.attributes) {
      return null;
    }

    const tracks = playlist.relationships?.tracks?.data ?? [];
    return {
      name: playlist.attributes.name,
      tracks: tracks
        .filter((track) => track.attributes)
        .map((track) => ({
          albumArt: this.buildAppleMusicArtworkUrl(track.attributes?.artwork?.url),
          artist: track.attributes!.artistName,
          durationMs: track.attributes!.durationInMillis,
          platform: "apple-music" as const,
          sourceLink: `https://music.apple.com/${storefront}/song/${track.id}`,
          title: track.attributes!.name,
        })),
      type: "playlist",
    };
  }

  private async findAppleLibraryPlaylistId(
    globalId: string,
    context: PreparedMusicLink,
    headers: Record<string, string>,
  ): Promise<string | null> {
    let offset = 0;
    do {
      const response = await this.appleMusicApiCall(
        `https://api.music.apple.com/v1/me/library/playlists?limit=100&offset=${offset}`,
        context,
        "apple-library-playlist-resolution",
        headers,
      );
      if (!response.ok) return null;
      const payload = await response.json() as {
        data?: Array<{ id: string; attributes?: { playParams?: { globalId?: string } } }>;
        next?: string;
      };
      const match = payload.data?.find((entry) => entry.attributes?.playParams?.globalId === globalId);
      if (match) return match.id;
      const count = payload.data?.length ?? 0;
      offset += count;
      if (!payload.next || count === 0 || offset >= 500) break;
    } while (true);
    return null;
  }

  private async searchAppleMusic(query: string, storefront = "us"): Promise<ParsedTrack[]> {
    const token = this.generateAppleMusicJwt();
    if (!token) return [];

    try {
      const params = new URLSearchParams({
        limit: "10",
        term: query,
        types: "songs",
      });
      const response = await this.resilientFetch(
        `https://api.music.apple.com/v1/catalog/${storefront}/search?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        {
          operation: "apple-search",
          provider: "apple-music",
          requestId: "apple-search",
        },
      );

      if (!response.ok) return [];

      const data = await response.json() as {
        results?: {
          songs?: {
            data?: AppleMusicSong[];
          };
        };
      };

      return (data.results?.songs?.data ?? [])
        .filter((song) => song.attributes?.name && song.attributes?.artistName)
        .map((song) => ({
          albumArt: this.buildAppleMusicArtworkUrl(song.attributes?.artwork?.url),
          artist: song.attributes!.artistName,
          durationMs: song.attributes?.durationInMillis,
          platform: "apple-music" as const,
          sourceLink: song.attributes?.url ?? `https://music.apple.com/${storefront}/song/${song.id}`,
          title: song.attributes!.name,
        }));
    } catch {
      return [];
    }
  }
}
