import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'crypto';

type RedisClient = any; // Lazy-loaded

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
  };
}

/** Cache TTL for song metadata — 24 hours */
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_PREFIX = 'music:track:';

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);
  private spotifyAccessToken: string | null = null;
  private spotifyTokenExpiry: number = 0;
  private redis: RedisClient | null = null;
  /** In-memory fallback cache when Redis is unavailable */
  private readonly memCache = new Map<string, { data: ParsedTrack; expiresAt: number }>();

  constructor(private configService: ConfigService) {
    this.initializeRedis();
  }

  private initializeRedis(): void {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) return;
    try {
      const Redis = require('ioredis');
      this.redis = new Redis(redisUrl);
      this.redis.on('error', (err: Error) => {
        this.logger.error(`Music cache Redis error: ${err.message}`);
        this.redis = null;
      });
    } catch {
      // ioredis not installed — use in-memory cache
    }
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
   * Get a valid Spotify access token, using cached token if available
   */
  private async getSpotifyAccessToken(): Promise<string | null> {
    const clientId = this.configService.get<string>('SPOTIFY_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SPOTIFY_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      this.logger.warn('Spotify credentials not configured');
      return null;
    }

    // Return cached token if still valid
    if (this.spotifyAccessToken && Date.now() < this.spotifyTokenExpiry) {
      return this.spotifyAccessToken;
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

  /**
   * Generate Apple Music JWT token
   */
  private generateAppleMusicJwt(): string | null {
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

      const now = Math.floor(Date.now() / 1000);
      const exp = now + 6 * 30 * 24 * 60 * 60; // 6 months

      const header = {
        alg: 'ES256',
        kid: keyId,
        typ: 'JWT',
      };

      const payload = {
        iss: teamId,
        iat: now,
        exp: exp,
      };

      const headerEncoded = this.base64UrlEncode(JSON.stringify(header));
      const payloadEncoded = this.base64UrlEncode(JSON.stringify(payload));
      const message = `${headerEncoded}.${payloadEncoded}`;

      // Sign with ES256 (ECDSA with SHA-256)
      const signature = createSign('sha256')
        .update(message)
        .sign({
          key: privateKey,
          format: 'pem',
        }, 'base64');

      const signatureEncoded = this.base64UrlEncode(
        Buffer.from(signature, 'base64').toString('binary')
      );

      return `${message}.${signatureEncoded}`;
    } catch (error) {
      this.logger.error('Failed to generate Apple Music JWT', error);
      return null;
    }
  }

  /**
   * Base64 URL encode (used for JWT)
   */
  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Extract Spotify track ID from URL
   */
  private extractSpotifyTrackId(url: string): string | null {
    // Format: https://open.spotify.com/track/TRACK_ID?si=xxx
    const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract Spotify album ID from URL
   */
  private extractSpotifyAlbumId(url: string): string | null {
    const match = url.match(/spotify\.com\/album\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract Spotify playlist ID from URL
   */
  private extractSpotifyPlaylistId(url: string): string | null {
    const match = url.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract Apple Music track ID from URL
   */
  private extractAppleMusicTrackId(url: string): string | null {
    // Format: https://music.apple.com/us/album/song-name/ALBUM_ID?i=TRACK_ID
    const match = url.match(/[?&]i=([0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract Apple Music album ID from URL (no ?i= track param)
   */
  private extractAppleMusicAlbumId(url: string): string | null {
    // Format: https://music.apple.com/us/album/album-name/ALBUM_ID (without ?i=)
    if (url.includes('?i=')) return null; // has track ID — it's a single track
    const match = url.match(/music\.apple\.com\/[a-z]{2}\/album\/[^/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * List tracks from a Spotify album
   */
  async listAlbumTracks(link: string): Promise<{ type: 'album' | 'playlist'; name: string; tracks: ParsedTrack[] } | null> {
    const isSpotify = link.includes('spotify.com');
    const isAppleMusic = link.includes('music.apple.com');

    if (isSpotify) {
      const albumId = this.extractSpotifyAlbumId(link);
      const playlistId = this.extractSpotifyPlaylistId(link);

      if (albumId) return this.listSpotifyAlbum(albumId);
      if (playlistId) return this.listSpotifyPlaylist(playlistId);
    }

    if (isAppleMusic) {
      const albumId = this.extractAppleMusicAlbumId(link);
      if (albumId) return this.listAppleMusicAlbum(albumId);
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
      if (!response.ok) return null;

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

  private async listSpotifyPlaylist(playlistId: string): Promise<{ type: 'playlist'; name: string; tracks: ParsedTrack[] } | null> {
    const token = await this.getSpotifyAccessToken();
    if (!token) return null;

    try {
      const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.items(track(id,name,artists(name),album(images),duration_ms))`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return null;

      const data = await response.json() as {
        name: string;
        tracks: { items: Array<{ track: SpotifyTrack & { id: string; duration_ms: number } }> };
      };

      const tracks: ParsedTrack[] = data.tracks.items
        .filter(item => item.track)
        .map(item => ({
          platform: 'spotify' as const,
          title: item.track.name,
          artist: item.track.artists.map(a => a.name).join(', '),
          albumArt: item.track.album?.images?.[0]?.url,
          sourceLink: `https://open.spotify.com/track/${item.track.id}`,
          durationMs: item.track.duration_ms,
        }));

      return { type: 'playlist', name: data.name, tracks };
    } catch (error) {
      this.logger.error('Spotify playlist listing error', error);
      return null;
    }
  }

  private async listAppleMusicAlbum(albumId: string): Promise<{ type: 'album'; name: string; tracks: ParsedTrack[] } | null> {
    const token = this.generateAppleMusicJwt();
    if (!token) return null;

    try {
      const response = await fetch(
        `https://api.music.apple.com/v1/catalog/us/albums/${albumId}`,
        { headers: { 'Authorization': `Bearer ${token}` } },
      );
      if (!response.ok) return null;

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

      const albumArt = album.attributes.artwork?.url;
      const trackList = album.relationships?.tracks?.data ?? [];
      const tracks: ParsedTrack[] = trackList
        .filter(t => t.attributes)
        .map(t => ({
          platform: 'apple-music' as const,
          title: t.attributes!.name,
          artist: t.attributes!.artistName,
          albumArt,
          sourceLink: `https://music.apple.com/us/song/${t.id}`,
          durationMs: t.attributes!.durationInMillis,
        }));

      return { type: 'album', name: album.attributes.name, tracks };
    } catch (error) {
      this.logger.error('Apple Music album listing error', error);
      return null;
    }
  }

  /**
   * Detect whether a link is for an album, playlist, or single track
   */
  detectLinkType(link: string): 'track' | 'album' | 'playlist' {
    if (link.includes('spotify.com/album/')) return 'album';
    if (link.includes('spotify.com/playlist/')) return 'playlist';
    if (link.includes('music.apple.com') && !link.includes('?i=')) {
      if (link.includes('/album/')) return 'album';
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
  private async lookupAppleMusicTrack(trackId: string): Promise<ParsedTrack | null> {
    const token = this.generateAppleMusicJwt();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(
        `https://api.music.apple.com/v1/catalog/us/songs/${trackId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Music-User-Token': '', // Optional, for personalization
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
        albumArt: song.attributes.artwork?.url,
        sourceLink: `https://music.apple.com/us/song/${trackId}`,
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
    const isSpotify = link.includes('spotify.com');
    const isAppleMusic = link.includes('music.apple.com');

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
      if (trackId) {
        result = await this.lookupAppleMusicTrack(trackId);
      }
    }

    if (result) {
      await this.setCache(cacheKey, result);
      return result;
    }

    // Fallback: return minimal data when API lookup fails (don't cache failures)
    return {
      platform,
      title: 'Unknown',
      artist: 'Unknown',
      sourceLink: link,
    };
  }

  /**
   * Get recent songs (placeholder for future implementation with real user history)
   */
  getRecentSongs() {
    // Hardcoded fallback catalog
    const SONG_CATALOG = [
      { id: 'song_1', title: 'Highest in the Room', artist: 'Travis Scott', platform: 'spotify' as const },
      { id: 'song_2', title: 'Risk It All', artist: 'Bruno Mars', platform: 'spotify' as const },
      { id: 'song_3', title: 'Blinding Lights', artist: 'The Weeknd', platform: 'spotify' as const },
      { id: 'song_4', title: 'Levitating', artist: 'Dua Lipa', platform: 'spotify' as const },
      { id: 'song_5', title: 'Peaches', artist: 'Justin Bieber', platform: 'apple-music' as const },
      { id: 'song_6', title: 'Stay', artist: 'The Kid LAROI & Justin Bieber', platform: 'spotify' as const },
      { id: 'song_7', title: 'Montero', artist: 'Lil Nas X', platform: 'apple-music' as const },
      { id: 'song_8', title: 'Kiss Me More', artist: 'Doja Cat ft. SZA', platform: 'spotify' as const },
    ];

    return SONG_CATALOG;
  }
}
