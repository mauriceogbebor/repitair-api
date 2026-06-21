import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { Repository } from 'typeorm';

import { User } from '../../entities';
import { REDIS_CLIENT } from '../../common/modules/redis.module';

type RedisClient = any;

export interface ParsedTrack {
  platform: 'spotify' | 'apple-music';
  title: string;
  artist: string;
  albumArt?: string;
  sourceLink: string;
  /** Track duration in milliseconds */
  durationMs?: number;
}

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

/** Cache TTL for song metadata — 24 hours */
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_PREFIX = 'music:track:';

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);
  private spotifyAccessToken: string | null = null;
  private spotifyTokenExpiry: number = 0;
  /** In-memory fallback cache when Redis is unavailable */
  private readonly memCache = new Map<string, { data: ParsedTrack; expiresAt: number }>();
  private appleMusicJwt: string | null = null;
  private appleMusicJwtExpiry: number = 0;
  /** Promise deduplication — prevents concurrent token fetches */
  private pendingSpotifyToken: Promise<string | null> | null = null;
  private pendingAppleMusicJwt: Promise<string | null> | null = null;

  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: RedisClient | null,
  ) {}

  private isSpotifyLink(link: string): boolean {
    return link.includes('spotify.com');
  }

  private isAppleMusicLink(link: string): boolean {
    return link.includes('music.apple.com') || link.includes('itunes.apple.com');
  }

  private async getCached(key: string): Promise<ParsedTrack | null> {
    const fullKey = CACHE_PREFIX + key;
    if (this.redis) {
      try {
        const raw = await this.redis.get(fullKey);
        if (raw) return JSON.parse(raw) as ParsedTrack;
      } catch {
        // fall through to memCache
      }
    }
    const entry = this.memCache.get(fullKey);
    if (entry && Date.now() < entry.expiresAt) return entry.data;
    if (entry) this.memCache.delete(fullKey);
    return null;
  }

  private async setCache(key: string, data: ParsedTrack): Promise<void> {
    const fullKey = CACHE_PREFIX + key;
    if (this.redis) {
      try {
        await this.redis.setex(fullKey, CACHE_TTL_SECONDS, JSON.stringify(data));
        return;
      } catch {
        // fall through to memCache
      }
    }
    this.memCache.set(fullKey, { data, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
  }

  /**
   * Get the user's stored Apple Music user token for personal playlist access.
   */
  async getUserAppleMusicToken(userId: string): Promise<string | null> {
    const user = await this.usersRepo
      .createQueryBuilder("user")
      .addSelect("user.appleMusicUserToken")
      .where("user.id = :id", { id: userId })
      .getOne();
    return user?.appleMusicUserToken ?? null;
  }

  /**
   * Get a valid Spotify access token, using cached token if available
   */
  private async getSpotifyAccessToken(): Promise<string | null> {
    // Return cached token if still valid
    if (this.spotifyAccessToken && Date.now() < this.spotifyTokenExpiry) {
      return this.spotifyAccessToken;
    }

    // Deduplicate concurrent fetches
    if (this.pendingSpotifyToken) return this.pendingSpotifyToken;

    this.pendingSpotifyToken = this.fetchSpotifyToken();
    try {
      return await this.pendingSpotifyToken;
    } finally {
      this.pendingSpotifyToken = null;
    }
  }

  private async fetchSpotifyToken(): Promise<string | null> {
    const clientId = this.configService.get<string>('SPOTIFY_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SPOTIFY_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      this.logger.warn('Spotify credentials not configured');
      return null;
    }

    try {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      if (!response.ok) {
        this.logger.error(`Spotify token request failed: ${response.status}`);
        return null;
      }

      const data = await response.json() as { access_token: string; expires_in: number };
      this.spotifyAccessToken = data.access_token;
      // Cache for (expires_in - 60) seconds to be safe
      this.spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

      return this.spotifyAccessToken;
    } catch (error) {
      this.logger.error('Failed to get Spotify access token', error);
      return null;
    }
  }

  private async getUserSpotifyAccessToken(userId: string): Promise<string | null> {
    const clientId = this.configService.get<string>('SPOTIFY_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SPOTIFY_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      this.logger.warn('Spotify credentials not configured');
      return null;
    }

    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.spotifyRefreshToken')
      .where('user.id = :userId', { userId })
      .getOne();

    const refreshToken = user?.spotifyRefreshToken;
    if (!refreshToken) {
      return null;
    }

    try {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        this.logger.warn(`Spotify refresh token exchange failed for user ${userId}: ${response.status}`);
        // 400/401 means the refresh token has been revoked or is invalid.
        // Clear the stale token so the user's connectedPlatforms reflects
        // reality and they know to reconnect.
        if (response.status === 400 || response.status === 401) {
          this.logger.warn(`Clearing revoked Spotify refresh token for user ${userId}`);
          await this.usersRepo.update(userId, { spotifyRefreshToken: undefined });
        }
        return null;
      }

      const data = await response.json() as { access_token?: string; refresh_token?: string };

      // Spotify may rotate the refresh token — persist the new one if provided
      if (data.refresh_token && data.refresh_token !== refreshToken) {
        await this.usersRepo.update(userId, { spotifyRefreshToken: data.refresh_token });
      }

      return data.access_token ?? null;
    } catch (error) {
      this.logger.error(`Failed to refresh Spotify access token for user ${userId}`, error);
      return null;
    }
  }

  /**
   * Generate Apple Music JWT token
   */
  private generateAppleMusicJwt(): string | null {
    // Return cached token if still valid (refresh 1 day before expiry)
    if (this.appleMusicJwt && Date.now() < this.appleMusicJwtExpiry) {
      return this.appleMusicJwt;
    }

    const teamId = this.configService.get<string>('APPLE_MUSIC_TEAM_ID');
    const keyId = this.configService.get<string>('APPLE_MUSIC_KEY_ID');
    const privateKeyStr = this.configService.get<string>('APPLE_MUSIC_PRIVATE_KEY');

    if (!teamId || !keyId || !privateKeyStr) {
      this.logger.warn('Apple Music credentials not configured');
      return null;
    }

    try {
      // Convert \n string literals to actual newlines
      const privateKey = privateKeyStr.replace(/\\n/g, '\n');

      // Use jsonwebtoken which correctly produces IEEE P1363 signatures
      // (raw r||s) instead of DER-encoded signatures that Apple rejects.
      const token = jwt.sign({}, privateKey, {
        algorithm: 'ES256',
        expiresIn: '180d',
        issuer: teamId,
        header: {
          alg: 'ES256',
          kid: keyId,
        },
      });

      this.appleMusicJwt = token;
      // Cache for 179 days (token is valid for 180)
      this.appleMusicJwtExpiry = Date.now() + 179 * 24 * 60 * 60 * 1000;

      return token;
    } catch (error) {
      this.logger.error('Failed to generate Apple Music JWT', error);
      return null;
    }
  }

  /**
   * Extract Spotify track ID from URL
   */
  private extractSpotifyTrackId(url: string): string | null {
    // Format: https://open.spotify.com/track/TRACK_ID?si=xxx
    // Also handles /intl-{country}/ prefix
    const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract Spotify album ID from URL
   */
  private extractSpotifyAlbumId(url: string): string | null {
    const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?album\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract Spotify playlist ID from URL
   */
  private extractSpotifyPlaylistId(url: string): string | null {
    const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract Apple Music storefront (country code) from URL.
   * Falls back to "us" if not found.
   */
  private extractAppleMusicStorefront(url: string): string {
    // Format: https://music.apple.com/{storefront}/album/...
    // Also supports https://itunes.apple.com/{storefront}/...
    const match = url.match(/(?:music|itunes)\.apple\.com\/([a-z]{2})\//);
    return match ? match[1] : 'us';
  }

  private buildAppleMusicArtworkUrl(url?: string, size = 600): string | undefined {
    if (!url) {
      return undefined;
    }

    return url
      .replace('{w}', String(size))
      .replace('{h}', String(size));
  }

  /**
   * Extract Apple Music track ID from URL.
   * Supports two formats:
   *   - Album link with track param: /album/name/ALBUM_ID?i=TRACK_ID
   *   - Direct song link: /song/name/TRACK_ID
   */
  private extractAppleMusicTrackId(url: string): string | null {
    // Format 1: https://music.apple.com/ng/album/song-name/ALBUM_ID?i=TRACK_ID
    const paramMatch = url.match(/[?&]i=([0-9]+)/);
    if (paramMatch) return paramMatch[1];

    // Format 2: https://music.apple.com/us/song/song-name/TRACK_ID
    const songWithName = url.match(/(?:music|itunes)\.apple\.com\/[a-z]{2}\/song\/[^/]+\/(\d+)/);
    if (songWithName) return songWithName[1];

    // Format 3: https://music.apple.com/ng/song/TRACK_ID (no name segment — generated by our album/playlist listing)
    const songDirect = url.match(/(?:music|itunes)\.apple\.com\/[a-z]{2}\/song\/(\d+)(?:\?|$)/);
    return songDirect ? songDirect[1] : null;
  }

  /**
   * Extract Apple Music playlist ID from URL
   */
  private extractAppleMusicPlaylistId(url: string): string | null {
    // Format: https://music.apple.com/{storefront}/playlist/{name}/{playlistId}
    // Playlist IDs can contain letters, numbers, dots, and hyphens (e.g. pl.u-xxxxx)
    const match = url.match(/(?:music|itunes)\.apple\.com\/[a-z]{2}\/playlist\/[^/]+\/([a-zA-Z0-9._-]+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract Apple Music album ID from URL (no ?i= track param)
   */
  private extractAppleMusicAlbumId(url: string): string | null {
    // Format: https://music.apple.com/ng/album/album-name/ALBUM_ID (without ?i=)
    if (url.includes('?i=')) return null; // has track ID — it's a single track
    const match = url.match(/(?:music|itunes)\.apple\.com\/[a-z]{2}\/album\/[^/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * List tracks from a Spotify album
   */
  async listAlbumTracks(link: string, userId?: string): Promise<{ type: 'album' | 'playlist'; name: string; tracks: ParsedTrack[] } | null> {
    const isSpotify = this.isSpotifyLink(link);
    const isAppleMusic = this.isAppleMusicLink(link);

    if (isSpotify) {
      const albumId = this.extractSpotifyAlbumId(link);
      const playlistId = this.extractSpotifyPlaylistId(link);

      if (albumId) return this.listSpotifyAlbum(albumId);
      if (playlistId) return this.listSpotifyPlaylist(playlistId, userId);
    }

    if (isAppleMusic) {
      const storefront = this.extractAppleMusicStorefront(link);
      const playlistId = this.extractAppleMusicPlaylistId(link);
      if (playlistId) return this.listAppleMusicPlaylist(playlistId, storefront, userId);
      const albumId = this.extractAppleMusicAlbumId(link);
      if (albumId) return this.listAppleMusicAlbum(albumId, storefront);
    }

    return null;
  }

  private async listSpotifyAlbum(albumId: string): Promise<{ type: 'album'; name: string; tracks: ParsedTrack[] } | null> {
    const token = await this.getSpotifyAccessToken();
    if (!token) return null;

    try {
      const response = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        this.logger.warn(`Spotify album lookup failed: ${response.status} ${response.statusText} (album=${albumId})`);
        return null;
      }

      const data = await response.json() as {
        name: string;
        images: Array<{ url: string }>;
        tracks: { items: Array<{ id: string; name: string; artists: Array<{ name: string }>; duration_ms: number }> };
      };

      const albumArt = data.images?.[0]?.url;
      const tracks: ParsedTrack[] = data.tracks.items.map(t => ({
        platform: 'spotify' as const,
        title: t.name,
        artist: t.artists.map(a => a.name).join(', '),
        albumArt,
        sourceLink: `https://open.spotify.com/track/${t.id}`,
        durationMs: t.duration_ms,
      }));

      return { type: 'album', name: data.name, tracks };
    } catch (error) {
      this.logger.error('Spotify album listing error', error);
      return null;
    }
  }

  private async listSpotifyPlaylist(playlistId: string, userId?: string): Promise<{ type: 'playlist'; name: string; tracks: ParsedTrack[] } | null> {
    // Try user token first (required for private playlists), fall back to client credentials
    let token: string | null = null;
    let usedUserToken = false;
    if (userId) {
      token = await this.getUserSpotifyAccessToken(userId);
      usedUserToken = Boolean(token);
    }
    if (!token) {
      token = await this.getSpotifyAccessToken();
    }
    if (!token) return null;

    try {
      const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      // If client credentials got a 403, retry with user token (if we haven't already)
      if (response.status === 403 && userId && !usedUserToken) {
        const userToken = await this.getUserSpotifyAccessToken(userId);
        if (userToken) {
          const retryResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
            headers: { 'Authorization': `Bearer ${userToken}` },
          });
          if (retryResponse.ok) {
            return this.parseSpotifyPlaylistResponse(playlistId, retryResponse);
          }
        }
      }

      if (!response.ok) {
        this.logger.warn(`Spotify playlist lookup failed: ${response.status} ${response.statusText} (playlist=${playlistId})`);
        return null;
      }

      return this.parseSpotifyPlaylistResponse(playlistId, response);
    } catch (error) {
      this.logger.error('Spotify playlist listing error', error);
      return null;
    }
  }

  private async parseSpotifyPlaylistResponse(playlistId: string, response: Response): Promise<{ type: 'playlist'; name: string; tracks: ParsedTrack[] } | null> {
    const data = await response.json() as {
      name: string;
      tracks: { items: Array<{ track: { id: string; name: string; artists: Array<{ name: string }>; album?: { images?: Array<{ url: string }> }; duration_ms: number } | null }> };
    };

    const tracks: ParsedTrack[] = data.tracks.items
      .filter(item => item.track)
      .map(item => ({
        platform: 'spotify' as const,
        title: item.track!.name,
        artist: item.track!.artists.map(a => a.name).join(', '),
        albumArt: item.track!.album?.images?.[0]?.url,
        sourceLink: `https://open.spotify.com/track/${item.track!.id}`,
        durationMs: item.track!.duration_ms,
      }));

    return { type: 'playlist', name: data.name, tracks };
  }

  private async listAppleMusicAlbum(albumId: string, storefront = 'us'): Promise<{ type: 'album'; name: string; tracks: ParsedTrack[] } | null> {
    const token = this.generateAppleMusicJwt();
    if (!token) {
      this.logger.warn('Apple Music JWT generation failed — cannot list album');
      return null;
    }

    try {
      const response = await fetch(
        `https://api.music.apple.com/v1/catalog/${storefront}/albums/${albumId}?include=tracks`,
        { headers: { 'Authorization': `Bearer ${token}` } },
      );
      if (!response.ok) {
        this.logger.warn(`Apple Music album lookup failed: ${response.status} ${response.statusText} (album=${albumId}, storefront=${storefront})`);
        return null;
      }

      const data = await response.json() as {
        data?: Array<{
          attributes?: { name: string; artwork?: { url: string } };
          relationships?: {
            tracks?: {
              data?: Array<{
                id: string;
                attributes?: { name: string; artistName: string; durationInMillis?: number };
              }>;
            };
          };
        }>;
      };

      const album = data.data?.[0];
      if (!album?.attributes) return null;

      const albumArt = this.buildAppleMusicArtworkUrl(album.attributes.artwork?.url);
      const trackList = album.relationships?.tracks?.data ?? [];
      const tracks: ParsedTrack[] = trackList
        .filter(t => t.attributes)
        .map(t => ({
          platform: 'apple-music' as const,
          title: t.attributes!.name,
          artist: t.attributes!.artistName,
          albumArt,
          sourceLink: `https://music.apple.com/${storefront}/song/${t.id}`,
          durationMs: t.attributes!.durationInMillis,
        }));

      return { type: 'album', name: album.attributes.name, tracks };
    } catch (error) {
      this.logger.error('Apple Music album listing error', error);
      return null;
    }
  }

  private async listAppleMusicPlaylist(playlistId: string, storefront = 'us', userId?: string): Promise<{ type: 'playlist'; name: string; tracks: ParsedTrack[] } | null> {
    const devToken = this.generateAppleMusicJwt();
    if (!devToken) {
      this.logger.warn('Apple Music JWT generation failed — cannot list playlist');
      return null;
    }

    const isPersonal = playlistId.startsWith('pl.u-');

    try {
      // Personal playlists (pl.u-*) use the library endpoint with Music-User-Token
      // Public/editorial playlists use the catalog endpoint
      let apiUrl: string;
      const headers: Record<string, string> = { 'Authorization': `Bearer ${devToken}` };

      if (isPersonal) {
        // User's library playlist — requires Music-User-Token
        const userToken = userId ? await this.getUserAppleMusicToken(userId) : null;
        if (!userToken) {
          this.logger.warn(`No Apple Music user token for personal playlist (playlist=${playlistId}, user=${userId})`);
          return null;
        }
        headers['Music-User-Token'] = userToken;
        apiUrl = `https://api.music.apple.com/v1/me/library/playlists/${playlistId}?include=tracks`;
      } else {
        apiUrl = `https://api.music.apple.com/v1/catalog/${storefront}/playlists/${playlistId}?include=tracks`;
      }

      const response = await fetch(apiUrl, { headers });
      if (!response.ok) {
        this.logger.warn(`Apple Music playlist lookup failed: ${response.status} ${response.statusText} (playlist=${playlistId}, storefront=${storefront}, personal=${isPersonal})`);
        return null;
      }

      const data = await response.json() as {
        data?: Array<{
          attributes?: { name: string; artwork?: { url: string } };
          relationships?: {
            tracks?: {
              data?: Array<{
                id: string;
                attributes?: { name: string; artistName: string; artwork?: { url: string }; durationInMillis?: number };
              }>;
            };
          };
        }>;
      };

      const playlist = data.data?.[0];
      if (!playlist?.attributes) return null;

      const trackList = playlist.relationships?.tracks?.data ?? [];
      const tracks: ParsedTrack[] = trackList
        .filter(t => t.attributes)
        .map(t => ({
          platform: 'apple-music' as const,
          title: t.attributes!.name,
          artist: t.attributes!.artistName,
          albumArt: this.buildAppleMusicArtworkUrl(t.attributes!.artwork?.url),
          sourceLink: `https://music.apple.com/${storefront}/song/${t.id}`,
          durationMs: t.attributes!.durationInMillis,
        }));

      return { type: 'playlist', name: playlist.attributes.name, tracks };
    } catch (error) {
      this.logger.error('Apple Music playlist listing error', error);
      return null;
    }
  }

  /**
   * Check if a playlist link points to a personal/private playlist
   * that can't be accessed via the public catalog API.
   * - Apple Music: personal playlists have IDs starting with "pl.u-"
   * - Spotify: we can't tell upfront, but client credentials will get a 403
   */
  isPersonalPlaylist(link: string): boolean {
    if (this.isAppleMusicLink(link)) {
      const playlistId = this.extractAppleMusicPlaylistId(link);
      return playlistId?.startsWith('pl.u-') ?? false;
    }
    return false;
  }

  /**
   * Detect whether a link is for an album, playlist, or single track
   */
  detectLinkType(link: string): 'track' | 'album' | 'playlist' {
    // Spotify URLs may include /intl-{country}/ prefix (e.g. /intl-de/playlist/...)
    if (/spotify\.com\/(intl-[a-z]+\/)?album\//.test(link)) return 'album';
    if (/spotify\.com\/(intl-[a-z]+\/)?playlist\//.test(link)) return 'playlist';
    if (this.isAppleMusicLink(link)) {
      // Direct song links are always tracks
      if (link.includes('/song/')) return 'track';
      // Album links with ?i= are single tracks
      if (link.includes('?i=')) return 'track';
      // Album links without ?i= are albums
      if (link.includes('/album/')) return 'album';
      // Playlist links
      if (link.includes('/playlist/')) return 'playlist';
    }
    return 'track';
  }

  /**
   * Look up a Spotify track by ID
   */
  private async lookupSpotifyTrack(trackId: string): Promise<ParsedTrack | null> {
    const token = await this.getSpotifyAccessToken();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        this.logger.warn(`Spotify track lookup failed: ${response.status}`);
        return null;
      }

      const track = await response.json() as SpotifyTrack;
      return {
        platform: 'spotify',
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        albumArt: track.album?.images?.[0]?.url,
        sourceLink: `https://open.spotify.com/track/${trackId}`,
        durationMs: track.duration_ms,
      };
    } catch (error) {
      this.logger.error('Spotify track lookup error', error);
      return null;
    }
  }

  /**
   * Look up an Apple Music track by ID
   */
  private async lookupAppleMusicTrack(trackId: string, storefront = 'us'): Promise<ParsedTrack | null> {
    const token = this.generateAppleMusicJwt();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(
        `https://api.music.apple.com/v1/catalog/${storefront}/songs/${trackId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        this.logger.warn(`Apple Music track lookup failed: ${response.status}`);
        return null;
      }

      const data = await response.json() as { data?: AppleMusicSong[] };
      const song = data.data?.[0];

      if (!song?.attributes) {
        return null;
      }

      return {
        platform: 'apple-music',
        title: song.attributes.name,
        artist: song.attributes.artistName,
        albumArt: this.buildAppleMusicArtworkUrl(song.attributes.artwork?.url),
        sourceLink: `https://music.apple.com/${storefront}/song/${trackId}`,
        durationMs: song.attributes.durationInMillis,
      };
    } catch (error) {
      this.logger.error('Apple Music track lookup error', error);
      return null;
    }
  }

  /**
   * Parse a music link and return track information.
   * Results are cached for 24 hours in Redis (or in-memory fallback).
   */
  async parseLink(link: string): Promise<ParsedTrack> {
    const isSpotify = this.isSpotifyLink(link);
    const isAppleMusic = this.isAppleMusicLink(link);

    if (!isSpotify && !isAppleMusic) {
      throw new BadRequestException(
        'Please paste a valid Spotify or Apple Music link.',
      );
    }

    // Determine platform
    let platform: 'spotify' | 'apple-music' = 'spotify';
    if (isAppleMusic) {
      platform = 'apple-music';
    }

    // Check cache first
    const cacheKey = link.replace(/[^a-zA-Z0-9]/g, '_');
    const cached = await this.getCached(cacheKey);
    if (cached) return cached;

    // Try to look up the track
    let result: ParsedTrack | null = null;

    if (isSpotify) {
      const trackId = this.extractSpotifyTrackId(link);
      if (trackId) {
        result = await this.lookupSpotifyTrack(trackId);
      }
    } else if (isAppleMusic) {
      const trackId = this.extractAppleMusicTrackId(link);
      const storefront = this.extractAppleMusicStorefront(link);
      if (trackId) {
        result = await this.lookupAppleMusicTrack(trackId, storefront);
      }
    }

    if (result) {
      await this.setCache(cacheKey, result);
      return result;
    }

    throw new BadRequestException(
      "We couldn't fetch song details from that link. Please try another Spotify or Apple Music link.",
    );
  }

  /**
   * Search for tracks on Spotify by query string.
   * Returns up to 10 results.
   */
  async search(
    query: string,
    platform: 'spotify' | 'apple-music' = 'spotify',
    storefront = 'us',
  ): Promise<ParsedTrack[]> {
    if (!query?.trim()) return [];

    if (platform === 'apple-music') {
      return this.searchAppleMusic(query, storefront);
    }

    const token = await this.getSpotifyAccessToken();
    if (!token) return [];

    try {
      const params = new URLSearchParams({
        q: query,
        type: 'track',
        limit: '10',
      });
      const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) return [];

      const data = await response.json() as {
        tracks?: {
          items: Array<SpotifyTrack & { id: string; duration_ms: number }>;
        };
      };

      return (data.tracks?.items ?? []).map((t) => ({
        platform: 'spotify' as const,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        albumArt: t.album?.images?.[0]?.url,
        sourceLink: `https://open.spotify.com/track/${t.id}`,
        durationMs: t.duration_ms,
      }));
    } catch (error) {
      this.logger.error('Spotify search error', error);
      return [];
    }
  }

  private async searchAppleMusic(query: string, storefront = 'us'): Promise<ParsedTrack[]> {
    const token = this.generateAppleMusicJwt();
    if (!token) {
      return [];
    }

    try {
      const params = new URLSearchParams({
        term: query,
        types: 'songs',
        limit: '10',
      });
      const response = await fetch(
        `https://api.music.apple.com/v1/catalog/${storefront}/search?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        return [];
      }

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
          platform: 'apple-music' as const,
          title: song.attributes!.name,
          artist: song.attributes!.artistName,
          albumArt: this.buildAppleMusicArtworkUrl(song.attributes?.artwork?.url),
          sourceLink: song.attributes?.url ?? `https://music.apple.com/${storefront}/song/${song.id}`,
          durationMs: song.attributes?.durationInMillis,
        }));
    } catch (error) {
      this.logger.error('Apple Music search error', error);
      return [];
    }
  }

  /**
   * Get recently played songs for a user.
   * Uses the user's Spotify refresh token to fetch their listening history.
   * Falls back to empty array if the user has no connected platform.
   */
  async getRecentSongs(userId?: string): Promise<ParsedTrack[]> {
    // Without a user-specific token, we can't fetch personalized history
    if (!userId) return [];

    const token = await this.getUserSpotifyAccessToken(userId);
    if (!token) return [];

    try {
      const response = await fetch(
        'https://api.spotify.com/v1/me/player/recently-played?limit=10',
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        this.logger.warn(`Spotify recent songs request failed for user ${userId}: ${response.status}`);
        return [];
      }

      const data = await response.json() as {
        items?: Array<{
          track: SpotifyTrack & { id: string; duration_ms?: number };
        }>;
      };

      return (data.items ?? []).map(({ track }) => ({
        platform: 'spotify' as const,
        title: track.name,
        artist: track.artists.map((a) => a.name).join(', '),
        albumArt: track.album?.images?.[0]?.url,
        sourceLink: `https://open.spotify.com/track/${track.id}`,
        durationMs: track.duration_ms,
      }));
    } catch (error) {
      this.logger.error(`Spotify recent songs fetch failed for user ${userId}`, error);
      return [];
    }
  }
}
