import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'crypto';

export interface ParsedTrack {
  platform: 'spotify' | 'apple-music';
  title: string;
  artist: string;
  albumArt?: string;
  sourceLink: string;
}

interface SpotifyTrack {
  name: string;
  artists: Array<{ name: string }>;
  album?: {
    images: Array<{ url: string }>;
  };
}

interface AppleMusicSong {
  attributes?: {
    name: string;
    artistName: string;
    artwork?: {
      url: string;
    };
  };
}

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);
  private spotifyAccessToken: string | null = null;
  private spotifyTokenExpiry: number = 0;

  constructor(private configService: ConfigService) {}

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
   * Extract Apple Music track ID from URL
   */
  private extractAppleMusicTrackId(url: string): string | null {
    // Format: https://music.apple.com/us/album/song-name/ALBUM_ID?i=TRACK_ID
    const match = url.match(/[?&]i=([0-9]+)/);
    return match ? match[1] : null;
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
      };
    } catch (error) {
      this.logger.error('Apple Music track lookup error', error);
      return null;
    }
  }

  /**
   * Parse a music link and return track information
   */
  async parseLink(link: string): Promise<ParsedTrack> {
    const isSpotify = link.includes('spotify.com');
    const isAppleMusic = link.includes('music.apple.com');

    // Determine platform
    let platform: 'spotify' | 'apple-music' = 'spotify';
    if (isAppleMusic) {
      platform = 'apple-music';
    }

    // Try to look up the track
    if (isSpotify) {
      const trackId = this.extractSpotifyTrackId(link);
      if (trackId) {
        const track = await this.lookupSpotifyTrack(trackId);
        if (track) {
          return track;
        }
      }
    } else if (isAppleMusic) {
      const trackId = this.extractAppleMusicTrackId(link);
      if (trackId) {
        const track = await this.lookupAppleMusicTrack(trackId);
        if (track) {
          return track;
        }
      }
    }

    // Fallback: return minimal data when API lookup fails
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
