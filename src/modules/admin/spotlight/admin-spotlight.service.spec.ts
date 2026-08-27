import { BadRequestException, ConflictException } from "@nestjs/common";
import { AdminSpotlightService } from "./admin-spotlight.service";
import { isSupportedSpotlightDestination } from "./spotlight-destination";
import { isSupportedSpotlightSongLink } from "./spotlight-song-link";

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "spotlight-1",
    title: "Campaign",
    subtitle: null,
    artist: "Artist",
    song: null,
    songLink: "https://open.spotify.com/track/test-track",
    albumArt: "https://cdn.example/art.jpg",
    backgroundImage: null,
    campaignType: "editorial",
    buttonLabel: "Create Repit",
    deepLink: "/create/pick-template?fresh=1",
    tag: "TRENDING",
    priority: 1,
    status: "draft",
    impressionCount: 0,
    tapCount: 0,
    startsAt: null,
    expiresAt: null,
    scheduledAt: null,
    publishedAt: null,
    archivedAt: null,
    submitterEmail: null,
    createdByAdminUserId: null,
    createdByAdminEmail: null,
    updatedByAdminUserId: null,
    updatedByAdminEmail: null,
    duplicateOfSpotlightId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function setup(initialCampaign = campaign()) {
  const transactionRepository = {
    create: jest.fn((value) => value),
    findOne: jest.fn().mockResolvedValue(initialCampaign),
    save: jest.fn(async (value) => value),
  };
  const manager = { getRepository: jest.fn().mockReturnValue(transactionRepository) };
  const dataSource = {
    transaction: jest.fn(async (work) => work(manager)),
  };
  const rootRepository = {
    findOne: jest.fn().mockResolvedValue(initialCampaign),
  };
  const auditRepository = { find: jest.fn().mockResolvedValue([]) };
  const auditLogsService = { append: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminSpotlightService(
    rootRepository as never,
    auditRepository as never,
    dataSource as never,
    auditLogsService as never,
  );

  return { auditLogsService, manager, service, transactionRepository };
}

describe("AdminSpotlightService lifecycle", () => {
  it("creates campaigns as drafts and writes the audit in the same transaction", async () => {
    const created = campaign({ id: "new-spotlight" });
    const setupResult = setup(created);
    setupResult.transactionRepository.save.mockResolvedValue(created);

    await setupResult.service.createCampaign({
      title: "Campaign",
      artist: "Artist",
      albumArt: "https://cdn.example/art.jpg",
      songLink: "https://open.spotify.com/track/test-track",
    });

    expect(setupResult.transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        buttonLabel: "Create Repit",
        deepLink: "/create/pick-template?fresh=1",
        songLink: "https://open.spotify.com/track/test-track",
      }),
    );
    expect(setupResult.auditLogsService.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.spotlight.created" }),
      setupResult.manager,
    );
  });

  it("locks and rejects edits once a campaign is active", async () => {
    const setupResult = setup(campaign({ status: "active" }));

    await expect(
      setupResult.service.updateCampaign("spotlight-1", { title: "Changed" }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(setupResult.transactionRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: "pessimistic_write" } }),
    );
    expect(setupResult.transactionRepository.save).not.toHaveBeenCalled();
    expect(setupResult.auditLogsService.append).not.toHaveBeenCalled();
  });

  it("requires future, ordered schedule dates", async () => {
    const setupResult = setup();

    await expect(setupResult.service.scheduleCampaign("spotlight-1", {
      startsAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-02T00:00:00.000Z",
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(setupResult.transactionRepository.save).not.toHaveBeenCalled();
  });

  it("does not publish a future campaign as active", async () => {
    const setupResult = setup(campaign({ startsAt: new Date("2099-01-01T00:00:00.000Z") }));

    await expect(
      setupResult.service.publishCampaign("spotlight-1", {}),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(setupResult.transactionRepository.save).not.toHaveBeenCalled();
  });

  it("requires a supported song link before publishing", async () => {
    const setupResult = setup(campaign({ songLink: null }));

    await expect(
      setupResult.service.publishCampaign("spotlight-1", {}),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: "SpotlightSongLinkRequired" }),
    });

    expect(setupResult.transactionRepository.save).not.toHaveBeenCalled();
    expect(setupResult.auditLogsService.append).not.toHaveBeenCalled();
  });
});

describe("Spotlight destination policy", () => {
  it("allows only the fresh Repit creation route", () => {
    expect(isSupportedSpotlightDestination("/create/pick-template?fresh=1")).toBe(true);
    expect(isSupportedSpotlightDestination("/repit/abc-123")).toBe(false);
    expect(isSupportedSpotlightDestination("https://repitair.com/releases")).toBe(false);
    expect(isSupportedSpotlightDestination("/admin/settings")).toBe(false);
    expect(isSupportedSpotlightDestination("http://example.com")).toBe(false);
    expect(isSupportedSpotlightDestination("https://")).toBe(false);
    expect(isSupportedSpotlightDestination("https://user:secret@example.com/path")).toBe(false);
    expect(isSupportedSpotlightDestination("/repit/")).toBe(false);
  });
});

describe("Spotlight song-link policy", () => {
  it("accepts Spotify and Apple Music track URLs only", () => {
    expect(isSupportedSpotlightSongLink("https://open.spotify.com/track/track-id")).toBe(true);
    expect(isSupportedSpotlightSongLink("https://music.apple.com/gb/song/song-name/123456789")).toBe(true);
    expect(isSupportedSpotlightSongLink("https://music.apple.com/gb/album/album-name/123456789?i=987654321")).toBe(true);
    expect(isSupportedSpotlightSongLink("https://open.spotify.com/playlist/playlist-id")).toBe(false);
    expect(isSupportedSpotlightSongLink("https://music.apple.com/gb/album/album-name/123456789")).toBe(false);
    expect(isSupportedSpotlightSongLink("https://example.com/track/track-id")).toBe(false);
  });
});
