import { MusicLibraryService } from "./music-library.service";
import { MusicLibraryQueryDto, MusicProviderDto, PlaylistSortDto, PlaylistTracksQueryDto } from "./dto/music-library.dto";

describe("MusicLibraryService", () => {
  const connections = {
    spotifyAccessToken: jest.fn().mockResolvedValue("spotify-user-token"),
    appleMusicUserToken: jest.fn().mockResolvedValue("apple-user-token"),
    recordSync: jest.fn().mockResolvedValue(undefined),
    requireReauthorization: jest.fn().mockResolvedValue(undefined),
  };
  const collectionRepo = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({
      ...value,
      id: "collection-1",
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    })),
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const importRepo = {
    find: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const analytics = { track: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string) => key === "REPITAIR_WEB_BASE_URL" ? "https://repitair.com" : undefined),
  };
  let service: MusicLibraryService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MusicLibraryService(
      config as never,
      connections as never,
      collectionRepo as never,
      importRepo as never,
      analytics as never,
    );
  });

  afterEach(() => fetchSpy?.mockRestore());

  it("lists only playlists returned for the connected Spotify user", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "private-1",
        name: "My private mix",
        owner: { display_name: "Owner" },
        images: [{ url: "https://images.example/private.jpg" }],
        tracks: { total: 14 },
        collaborative: false,
      }],
      total: 1,
    }), { status: 200 }));

    const query = Object.assign(new MusicLibraryQueryDto(), {
      provider: MusicProviderDto.SPOTIFY,
      sort: PlaylistSortDto.RECENT,
      page: 1,
      limit: 20,
    });
    const result = await service.listPlaylists("user-1", query);

    expect(result.items).toEqual([expect.objectContaining({ id: "private-1", name: "My private mix" })]);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/me/playlists"),
      expect.objectContaining({ headers: { Authorization: "Bearer spotify-user-token" } }),
    );
    expect(connections.recordSync).toHaveBeenCalledWith("user-1", "spotify", 1);
  });

  it("does not reveal whether another account's private playlist exists", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(service.listPlaylistTracks(
      "user-1",
      "spotify",
      "another-users-private-list",
      Object.assign(new PlaylistTracksQueryDto(), { page: 1, limit: 50 }),
    )).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "PLAYLIST_PRIVATE" }),
      status: 404,
    });
  });

  it("marks an expired provider authorization for reconnect without exposing tokens", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unauthorized", { status: 401 }));

    await expect(service.listPlaylists("user-1", Object.assign(new MusicLibraryQueryDto(), {
      provider: MusicProviderDto.SPOTIFY,
    }))).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "MUSIC_CONNECTION_EXPIRED" }),
      status: 409,
    });
    expect(connections.requireReauthorization).toHaveBeenCalledWith("user-1", "spotify");
  });

  it("marks a rejected Apple Music User Token for reconnect", async () => {
    jest.spyOn(service as never, "appleDeveloperToken" as never).mockReturnValue("developer-token" as never);
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unauthorized", { status: 401 }));

    await expect(service.listPlaylists("user-1", Object.assign(new MusicLibraryQueryDto(), {
      provider: MusicProviderDto.APPLE_MUSIC,
    }))).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "MUSIC_CONNECTION_EXPIRED" }),
      status: 409,
    });
    expect(connections.requireReauthorization).toHaveBeenCalledWith("user-1", "apple-music");
  });

  it("creates a Repitair collection containing normalized metadata and no provider authorization", async () => {
    jest.spyOn(service, "loadProviderPlaylist").mockResolvedValue({
      tracks: [{
        id: "track-1",
        provider: "spotify",
        providerTrackId: "catalog-track-1",
        title: "Song",
        artist: "Artist",
        album: "Album",
        albumArt: "https://images.example/art.jpg",
        durationMs: 123000,
        explicit: false,
        sourceLink: "https://open.spotify.com/track/catalog-track-1",
      }],
      playlist: {
        id: "playlist-1",
        name: "Private mix",
        owner: "Owner",
        artworkUrl: null,
        songCount: 1,
        lastUpdated: null,
        provider: "spotify",
        isCollaborative: false,
        isPublic: false,
        lastImportedAt: null,
      },
    });

    const result = await service.createCollection("user-1", {
      provider: MusicProviderDto.SPOTIFY,
      playlistId: "playlist-1",
      trackIds: ["track-1"],
    });

    expect(result.shareUrl).toMatch(/^https:\/\/repitair\.com\/music\//);
    expect(result.tracks).toEqual([expect.objectContaining({ title: "Song", providerTrackId: "catalog-track-1" })]);
    expect(JSON.stringify(result)).not.toContain("token");
    expect(analytics.track).toHaveBeenCalledWith("music.collection_created", expect.any(Object));
  });

  it("preserves duplicate playlist occurrences as independently selectable songs", async () => {
    const duplicateTrack = {
      provider: "spotify" as const,
      providerTrackId: "catalog-track-1",
      title: "Song",
      artist: "Artist",
      album: "Album",
      albumArt: null,
      durationMs: 123000,
      explicit: false,
      sourceLink: "https://open.spotify.com/track/catalog-track-1",
    };
    jest.spyOn(service, "loadProviderPlaylist").mockResolvedValue({
      tracks: [
        { ...duplicateTrack, id: "catalog-track-1:0" },
        { ...duplicateTrack, id: "catalog-track-1:4" },
      ],
      playlist: {
        id: "playlist-1",
        name: "Duplicate mix",
        owner: "Owner",
        artworkUrl: null,
        songCount: 2,
        lastUpdated: null,
        provider: "spotify",
        isCollaborative: false,
        isPublic: false,
        lastImportedAt: null,
      },
    });

    const result = await service.createCollection("user-1", {
      provider: MusicProviderDto.SPOTIFY,
      playlistId: "playlist-1",
      trackIds: ["catalog-track-1:0", "catalog-track-1:4"],
    });

    expect(result.trackCount).toBe(2);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks.map((track) => track.providerTrackId)).toEqual([
      "catalog-track-1",
      "catalog-track-1",
    ]);
  });

  it("rejects stale selected track IDs instead of publishing a partial collection", async () => {
    jest.spyOn(service, "loadProviderPlaylist").mockResolvedValue({
      tracks: [{
        id: "track-1",
        provider: "spotify",
        providerTrackId: "track-1",
        title: "Song",
        artist: "Artist",
        album: null,
        albumArt: null,
        durationMs: null,
        explicit: null,
        sourceLink: "https://open.spotify.com/track/track-1",
      }],
      playlist: {
        id: "playlist-1",
        name: "Private mix",
        owner: "Owner",
        artworkUrl: null,
        songCount: 1,
        lastUpdated: null,
        provider: "spotify",
        isCollaborative: false,
        isPublic: false,
        lastImportedAt: null,
      },
    });

    await expect(service.createCollection("user-1", {
      provider: MusicProviderDto.SPOTIFY,
      playlistId: "playlist-1",
      trackIds: ["track-1", "removed-track"],
    })).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "PLAYLIST_CHANGED" }),
      status: 409,
    });
    expect(collectionRepo.save).not.toHaveBeenCalled();
  });

  it("records user-scoped playlist import history for recent-import sorting", async () => {
    await expect(service.recordPlaylistImport("user-1", {
      provider: MusicProviderDto.SPOTIFY,
      playlistId: "playlist-1",
      trackCount: 3,
    })).resolves.toEqual({ success: true });

    expect(importRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        provider: "spotify",
        playlistId: "playlist-1",
        trackCount: 3,
      }),
      ["userId", "provider", "playlistId"],
    );
    expect(analytics.track).toHaveBeenCalledWith("music.playlist_imported", {
      userId: "user-1",
      properties: { provider: "spotify", trackCount: 3 },
    });
  });
});
