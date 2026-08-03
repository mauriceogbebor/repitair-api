import {
  BadGatewayException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { randomBytes } from "crypto";
import * as jwt from "jsonwebtoken";
import { Repository } from "typeorm";

import {
  MusicCollection,
  MusicPlaylistImport,
  type MusicCollectionTrack,
  type MusicProviderName,
} from "../../entities";
import { AnalyticsService } from "../analytics/analytics.service";
import {
  CreateMusicCollectionDto,
  MusicLibraryQueryDto,
  PlaylistSortDto,
  PlaylistTracksQueryDto,
  RecordPlaylistImportDto,
} from "./dto/music-library.dto";
import { MusicConnectionsService } from "./music-connections.service";

const PROVIDER_TIMEOUT_MS = 12_000;
const MAX_COLLECTION_TRACKS = 100;

type ProviderPlaylist = {
  id: string;
  name: string;
  owner: string | null;
  artworkUrl: string | null;
  songCount: number;
  lastUpdated: string | null;
  provider: MusicProviderName;
  isCollaborative: boolean;
  isPublic: boolean | null;
  lastImportedAt: string | null;
};

type ProviderTrack = MusicCollectionTrack & {
  id: string;
};

type PageResult<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

type SpotifyImage = { url?: string | null };
type SpotifyPlaylist = {
  id: string;
  name?: string;
  owner?: { display_name?: string | null };
  images?: SpotifyImage[];
  tracks?: { total?: number };
  collaborative?: boolean;
  public?: boolean | null;
  snapshot_id?: string;
};
type SpotifyTrack = {
  id?: string | null;
  name?: string;
  duration_ms?: number;
  explicit?: boolean;
  external_urls?: { spotify?: string };
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: SpotifyImage[] };
  is_local?: boolean;
};

type AppleArtwork = { url?: string; width?: number; height?: number };
type ApplePlaylist = {
  id: string;
  attributes?: {
    name?: string;
    artwork?: AppleArtwork;
    trackCount?: number;
    dateAdded?: string;
    lastModifiedDate?: string;
    playParams?: { globalId?: string };
  };
};
type AppleTrack = {
  id: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    contentRating?: string;
    artwork?: AppleArtwork;
    url?: string;
    playParams?: { catalogId?: string; globalId?: string };
  };
};

@Injectable()
export class MusicLibraryService {
  constructor(
    private readonly config: ConfigService,
    private readonly connections: MusicConnectionsService,
    @InjectRepository(MusicCollection)
    private readonly collections: Repository<MusicCollection>,
    @InjectRepository(MusicPlaylistImport)
    private readonly imports: Repository<MusicPlaylistImport>,
    private readonly analytics: AnalyticsService,
  ) {}

  private providerError(
    provider: MusicProviderName,
    status: number,
    playlistContext = false,
  ): Error {
    if (status === 401) {
      return new ConflictException({
        errorCode: "MUSIC_CONNECTION_EXPIRED",
        message: `Reconnect ${provider === "spotify" ? "Spotify" : "Apple Music"} to continue.`,
        provider,
        retriable: false,
      });
    }
    if (status === 403 || (playlistContext && status === 404)) {
      return new NotFoundException({
        errorCode: "PLAYLIST_PRIVATE",
        message: "This playlist is private. Connect the account that owns it or ask the owner to share it through Repitair.",
        provider,
        retriable: false,
      });
    }
    if (status === 404) {
      return new NotFoundException({
        errorCode: "PLAYLIST_UNAVAILABLE",
        message: "This playlist was deleted or is no longer available.",
        provider,
        retriable: false,
      });
    }
    if (status === 429) {
      return new HttpException({
        errorCode: "PROVIDER_RATE_LIMIT",
        message: `${provider === "spotify" ? "Spotify" : "Apple Music"} is busy. Please try again shortly.`,
        provider,
        retriable: true,
      }, 429);
    }
    return new BadGatewayException({
      errorCode: "PROVIDER_UNAVAILABLE",
      message: `${provider === "spotify" ? "Spotify" : "Apple Music"} could not load playlists right now.`,
      provider,
      retriable: status >= 500,
    });
  }

  private async requestJson<T>(
    url: string,
    provider: MusicProviderName,
    headers: Record<string, string>,
    playlistContext = false,
    userId?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException({
        errorCode: "NETWORK_FAILURE",
        message: `Could not reach ${provider === "spotify" ? "Spotify" : "Apple Music"}. Check your connection and try again.`,
        provider,
        retriable: true,
      });
    }
    if (!response.ok) {
      if (response.status === 401 && userId) {
        await this.connections.requireReauthorization(userId, provider);
      }
      throw this.providerError(provider, response.status, playlistContext);
    }
    return response.json() as Promise<T>;
  }

  private appleDeveloperToken(): string {
    const teamId = this.config.get<string>("APPLE_MUSIC_TEAM_ID");
    const keyId = this.config.get<string>("APPLE_MUSIC_KEY_ID");
    const keyValue = this.config.get<string>("APPLE_MUSIC_PRIVATE_KEY");
    if (!teamId || !keyId || !keyValue) {
      throw new ServiceUnavailableException("Apple Music is not configured.");
    }
    return jwt.sign({}, keyValue.replace(/\\n/g, "\n"), {
      algorithm: "ES256",
      issuer: teamId,
      keyid: keyId,
      expiresIn: "180d",
    });
  }

  private appleArtwork(artwork?: AppleArtwork): string | null {
    if (!artwork?.url) return null;
    return artwork.url.replace("{w}", "600").replace("{h}", "600");
  }

  private page<T>(items: T[], page: number, limit: number): PageResult<T> {
    const start = (page - 1) * limit;
    return {
      items: items.slice(start, start + limit),
      page,
      limit,
      total: items.length,
      hasMore: start + limit < items.length,
    };
  }

  async listPlaylists(userId: string, query: MusicLibraryQueryDto): Promise<PageResult<ProviderPlaylist>> {
    const provider = query.provider as MusicProviderName;
    let playlists = provider === "spotify"
      ? await this.spotifyPlaylists(userId)
      : await this.applePlaylists(userId);
    const importRows = await this.imports.find({ where: { userId, provider } });
    const importedAt = new Map(importRows.map((row) => [row.playlistId, row.importedAt.toISOString()]));
    playlists = playlists.map((playlist) => ({
      ...playlist,
      lastImportedAt: importedAt.get(playlist.id) ?? null,
    }));
    const providerPlaylistCount = playlists.length;
    const search = query.search?.toLocaleLowerCase();
    if (search) {
      playlists = playlists.filter((playlist) =>
        `${playlist.name} ${playlist.owner ?? ""}`.toLocaleLowerCase().includes(search),
      );
    }
    playlists.sort(query.sort === PlaylistSortDto.ALPHABETICAL
      ? (a, b) => a.name.localeCompare(b.name)
      : query.sort === PlaylistSortDto.RECENTLY_IMPORTED
        ? (a, b) => (b.lastImportedAt ?? "").localeCompare(a.lastImportedAt ?? "") || a.name.localeCompare(b.name)
        : (a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""));
    await this.connections.recordSync(userId, provider, providerPlaylistCount);
    return this.page(playlists, query.page ?? 1, query.limit ?? 20);
  }

  private async spotifyPlaylists(userId: string): Promise<ProviderPlaylist[]> {
    const token = await this.connections.spotifyAccessToken(userId);
    const all: ProviderPlaylist[] = [];
    let offset = 0;
    do {
      const payload = await this.requestJson<{ items?: SpotifyPlaylist[]; total?: number }>(
        `https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}`,
        "spotify",
        { Authorization: `Bearer ${token}` },
        false,
        userId,
      );
      const batch = payload.items ?? [];
      all.push(...batch.map((playlist) => ({
        id: playlist.id,
        name: playlist.name?.trim() || "Untitled playlist",
        owner: playlist.owner?.display_name?.trim() || null,
        artworkUrl: playlist.images?.find((image) => image.url)?.url ?? null,
        songCount: Number(playlist.tracks?.total ?? 0),
        lastUpdated: null,
        provider: "spotify" as const,
        isCollaborative: Boolean(playlist.collaborative),
        isPublic: typeof playlist.public === "boolean" ? playlist.public : null,
        lastImportedAt: null,
      })));
      offset += batch.length;
      if (!batch.length || offset >= Number(payload.total ?? 0) || all.length >= 500) break;
    } while (true);
    return all;
  }

  private async appleHeaders(userId: string): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${this.appleDeveloperToken()}`,
      "Music-User-Token": await this.connections.appleMusicUserToken(userId),
    };
  }

  private async applePlaylists(userId: string): Promise<ProviderPlaylist[]> {
    const headers = await this.appleHeaders(userId);
    const all: ProviderPlaylist[] = [];
    let offset = 0;
    do {
      const payload = await this.requestJson<{ data?: ApplePlaylist[]; next?: string }>(
        `https://api.music.apple.com/v1/me/library/playlists?limit=100&offset=${offset}`,
        "apple-music",
        headers,
        false,
        userId,
      );
      const batch = payload.data ?? [];
      all.push(...batch.map((playlist) => ({
        id: playlist.id,
        name: playlist.attributes?.name?.trim() || "Untitled playlist",
        owner: null,
        artworkUrl: this.appleArtwork(playlist.attributes?.artwork),
        songCount: Number(playlist.attributes?.trackCount ?? 0),
        lastUpdated: playlist.attributes?.lastModifiedDate ?? playlist.attributes?.dateAdded ?? null,
        provider: "apple-music" as const,
        isCollaborative: false,
        isPublic: null,
        lastImportedAt: null,
      })));
      offset += batch.length;
      if (!payload.next || !batch.length || all.length >= 500) break;
    } while (true);
    return all;
  }

  async listPlaylistTracks(
    userId: string,
    provider: MusicProviderName,
    playlistId: string,
    query: PlaylistTracksQueryDto,
  ): Promise<PageResult<ProviderTrack> & { playlist: ProviderPlaylist }> {
    const result = await this.loadProviderPlaylist(userId, provider, playlistId);
    await this.connections.recordSync(userId, provider);
    return { ...this.page(result.tracks, query.page ?? 1, query.limit ?? 50), playlist: result.playlist };
  }

  async loadProviderPlaylist(
    userId: string,
    provider: MusicProviderName,
    playlistId: string,
  ): Promise<{ tracks: ProviderTrack[]; playlist: ProviderPlaylist }> {
    return provider === "spotify"
      ? this.spotifyPlaylistTracks(userId, playlistId)
      : this.applePlaylistTracks(userId, playlistId);
  }

  private async spotifyPlaylistTracks(userId: string, playlistId: string) {
    const token = await this.connections.spotifyAccessToken(userId);
    const headers = { Authorization: `Bearer ${token}` };
    const playlist = await this.requestJson<SpotifyPlaylist>(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}?fields=id,name,owner(display_name),images,tracks(total),collaborative,public`,
      "spotify",
      headers,
      true,
      userId,
    );
    const tracks: ProviderTrack[] = [];
    let offset = 0;
    do {
      const payload = await this.requestJson<{ items?: Array<{ track?: SpotifyTrack | null; item?: SpotifyTrack | null }>; total?: number }>(
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=50&offset=${offset}`,
        "spotify",
        headers,
        true,
        userId,
      );
      const batch = payload.items ?? [];
      for (const wrapper of batch) {
        const track = wrapper.track ?? wrapper.item;
        if (!track?.id || track.is_local) continue;
        tracks.push({
          id: track.id,
          provider: "spotify",
          providerTrackId: track.id,
          title: track.name?.trim() || "Untitled track",
          artist: track.artists?.map((artist) => artist.name).filter(Boolean).join(", ") || "Unknown artist",
          album: track.album?.name?.trim() || null,
          albumArt: track.album?.images?.find((image) => image.url)?.url ?? null,
          durationMs: track.duration_ms ?? null,
          explicit: track.explicit ?? null,
          sourceLink: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
        });
      }
      offset += batch.length;
      if (!batch.length || offset >= Number(payload.total ?? 0) || tracks.length >= 500) break;
    } while (true);
    return {
      playlist: {
        id: playlist.id,
        name: playlist.name?.trim() || "Untitled playlist",
        owner: playlist.owner?.display_name?.trim() || null,
        artworkUrl: playlist.images?.find((image) => image.url)?.url ?? null,
        songCount: Number(playlist.tracks?.total ?? tracks.length),
        lastUpdated: null,
        provider: "spotify" as const,
        isCollaborative: Boolean(playlist.collaborative),
        isPublic: typeof playlist.public === "boolean" ? playlist.public : null,
        lastImportedAt: null,
      },
      tracks,
    };
  }

  private async resolveAppleLibraryPlaylist(
    userId: string,
    requestedId: string,
  ): Promise<{ playlist: ApplePlaylist; headers: Record<string, string> }> {
    const headers = await this.appleHeaders(userId);
    if (requestedId.startsWith("p.")) {
      const payload = await this.requestJson<{ data?: ApplePlaylist[] }>(
        `https://api.music.apple.com/v1/me/library/playlists/${encodeURIComponent(requestedId)}`,
        "apple-music",
        headers,
        true,
        userId,
      );
      const playlist = payload.data?.[0];
      if (!playlist) throw this.providerError("apple-music", 404, true);
      return { playlist, headers };
    }

    const library = await this.applePlaylistsRaw(userId, headers);
    const playlist = library.find((entry) => entry.attributes?.playParams?.globalId === requestedId);
    if (!playlist) throw this.providerError("apple-music", 404, true);
    return { playlist, headers };
  }

  private async applePlaylistsRaw(
    userId: string,
    headers: Record<string, string>,
  ): Promise<ApplePlaylist[]> {
    const all: ApplePlaylist[] = [];
    let offset = 0;
    do {
      const payload = await this.requestJson<{ data?: ApplePlaylist[]; next?: string }>(
        `https://api.music.apple.com/v1/me/library/playlists?limit=100&offset=${offset}`,
        "apple-music",
        headers,
        false,
        userId,
      );
      const batch = payload.data ?? [];
      all.push(...batch);
      offset += batch.length;
      if (!payload.next || !batch.length || all.length >= 500) break;
    } while (true);
    return all;
  }

  private async applePlaylistTracks(userId: string, requestedId: string) {
    const { playlist, headers } = await this.resolveAppleLibraryPlaylist(userId, requestedId);
    const tracks: ProviderTrack[] = [];
    let offset = 0;
    do {
      const payload = await this.requestJson<{ data?: AppleTrack[]; next?: string }>(
        `https://api.music.apple.com/v1/me/library/playlists/${encodeURIComponent(playlist.id)}/tracks?limit=100&offset=${offset}`,
        "apple-music",
        headers,
        true,
        userId,
      );
      const batch = payload.data ?? [];
      for (const track of batch) {
        const catalogId = track.attributes?.playParams?.catalogId ?? track.attributes?.playParams?.globalId ?? track.id;
        tracks.push({
          id: track.id,
          provider: "apple-music",
          providerTrackId: catalogId,
          title: track.attributes?.name?.trim() || "Untitled track",
          artist: track.attributes?.artistName?.trim() || "Unknown artist",
          album: track.attributes?.albumName?.trim() || null,
          albumArt: this.appleArtwork(track.attributes?.artwork),
          durationMs: track.attributes?.durationInMillis ?? null,
          explicit: track.attributes?.contentRating === "explicit"
            ? true
            : track.attributes?.contentRating ? false : null,
          sourceLink: track.attributes?.url ?? `https://music.apple.com/song/${catalogId}`,
        });
      }
      offset += batch.length;
      if (!payload.next || !batch.length || tracks.length >= 500) break;
    } while (true);
    return {
      playlist: {
        id: playlist.id,
        name: playlist.attributes?.name?.trim() || "Untitled playlist",
        owner: null,
        artworkUrl: this.appleArtwork(playlist.attributes?.artwork),
        songCount: Number(playlist.attributes?.trackCount ?? tracks.length),
        lastUpdated: playlist.attributes?.lastModifiedDate ?? playlist.attributes?.dateAdded ?? null,
        provider: "apple-music" as const,
        isCollaborative: false,
        isPublic: null,
        lastImportedAt: null,
      },
      tracks,
    };
  }

  async createCollection(userId: string, dto: CreateMusicCollectionDto) {
    const provider = dto.provider as MusicProviderName;
    const loaded = await this.loadProviderPlaylist(userId, provider, dto.playlistId);
    await this.connections.recordSync(userId, provider);
    const selected = dto.trackIds?.length
      ? loaded.tracks.filter((track) => dto.trackIds!.includes(track.id))
      : loaded.tracks.slice(0, MAX_COLLECTION_TRACKS);
    if (dto.trackIds?.length && selected.length !== dto.trackIds.length) {
      throw new ConflictException({
        errorCode: "PLAYLIST_CHANGED",
        message: "One or more selected songs are no longer available. Refresh the playlist and try again.",
        retriable: true,
      });
    }
    if (!selected.length) {
      throw new ConflictException({
        errorCode: "EMPTY_PLAYLIST",
        message: "Select at least one song before sharing this collection.",
        retriable: false,
      });
    }
    const shareCode = randomBytes(12).toString("base64url");
    const collection = await this.collections.save(this.collections.create({
      ownerId: userId,
      shareCode,
      name: dto.name?.trim() || loaded.playlist.name,
      sourceProvider: provider,
      sourcePlaylistId: dto.playlistId,
      artworkUrl: loaded.playlist.artworkUrl,
      tracks: selected.map(({ id: _id, ...track }) => track),
      trackCount: selected.length,
      sourceSyncedAt: new Date(),
    }));
    await this.analytics.track("music.collection_created", {
      userId,
      properties: { provider, trackCount: selected.length },
    });
    return this.collectionResponse(collection);
  }

  async recordPlaylistImport(userId: string, dto: RecordPlaylistImportDto) {
    const provider = dto.provider as MusicProviderName;
    await this.imports.upsert({
      userId,
      provider,
      playlistId: dto.playlistId,
      trackCount: dto.trackCount,
      importedAt: new Date(),
    }, ["userId", "provider", "playlistId"]);
    await this.analytics.track("music.playlist_imported", {
      userId,
      properties: { provider, trackCount: dto.trackCount },
    });
    return { success: true as const };
  }

  async listCollections(userId: string) {
    const collections = await this.collections.find({
      where: { ownerId: userId },
      order: { createdAt: "DESC" },
      take: 100,
    });
    return collections.map((collection) => this.collectionResponse(collection));
  }

  async getSharedCollection(shareCode: string) {
    if (!/^[A-Za-z0-9_-]{16}$/.test(shareCode)) {
      throw new NotFoundException({
        errorCode: "COLLECTION_NOT_FOUND",
        message: "This Repitair collection is no longer available.",
        retriable: false,
      });
    }
    const collection = await this.collections.findOne({ where: { shareCode } });
    if (!collection) {
      throw new NotFoundException({
        errorCode: "COLLECTION_NOT_FOUND",
        message: "This Repitair collection is no longer available.",
        retriable: false,
      });
    }
    await this.analytics.track("music.collection_opened", {
      properties: { collectionId: collection.id, trackCount: collection.trackCount },
    });
    return this.collectionResponse(collection);
  }

  private collectionResponse(collection: MusicCollection) {
    const webBase = this.config.get<string>("REPITAIR_WEB_BASE_URL")?.replace(/\/$/, "") || "https://repitair.com";
    return {
      id: collection.id,
      shareCode: collection.shareCode,
      shareUrl: `${webBase}/music/${collection.shareCode}`,
      name: collection.name,
      provider: collection.sourceProvider,
      artworkUrl: collection.artworkUrl ?? null,
      trackCount: collection.trackCount,
      tracks: collection.tracks,
      createdAt: collection.createdAt.toISOString(),
    };
  }
}
