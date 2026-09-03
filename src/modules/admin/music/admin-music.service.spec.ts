import { AdminMusicService } from "./admin-music.service";

function chain(overrides: Record<string, unknown> = {}) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    "select", "addSelect", "groupBy", "addGroupBy", "where", "andWhere",
    "leftJoin", "orderBy", "skip", "take",
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  Object.assign(qb, overrides);
  return qb;
}

describe("AdminMusicService", () => {
  it("aggregates provider status, expiring connections, and recent imports", async () => {
    const statusQb = chain({
      getRawMany: jest.fn().mockResolvedValue([
        { provider: "spotify", status: "connected", count: "4" },
        { provider: "spotify", status: "reauth_required", count: "2" },
        { provider: "apple-music", status: "connected", count: "3" },
      ]),
    });
    const expiringQb = chain({ getCount: jest.fn().mockResolvedValue(2) });
    const importQb = chain({
      getRawOne: jest.fn().mockResolvedValue({ importCount: "5", trackCount: "140" }),
    });
    const connectionsRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(statusQb)
        .mockReturnValueOnce(expiringQb),
    };
    const importsRepository = { createQueryBuilder: jest.fn().mockReturnValue(importQb) };
    const collectionsRepository = { count: jest.fn().mockResolvedValue(8) };
    const service = new AdminMusicService(
      connectionsRepository as never,
      importsRepository as never,
      collectionsRepository as never,
      {} as never,
      {} as never,
    );

    const result = await service.overview();

    expect(result.providers.spotify).toEqual({ connected: 4, reauthRequired: 2, disconnected: 0, total: 6 });
    expect(result.providers["apple-music"]).toEqual({ connected: 3, reauthRequired: 0, disconnected: 0, total: 3 });
    expect(result.expiringSoon).toBe(2);
    expect(result.recentImports).toEqual(expect.objectContaining({ importCount: 5, trackCount: 140 }));
    expect(result.totalCollections).toBe(8);
    expect(result.callbackFailuresAvailable).toBe(false);
    expect(importsRepository.createQueryBuilder).toHaveBeenCalledWith("music_import");
    expect(importQb.addSelect).toHaveBeenCalledWith(
      'COALESCE(SUM(music_import."trackCount"), 0)',
      "trackCount",
    );
    expect(importQb.where).toHaveBeenCalledWith(
      'music_import."importedAt" >= :importSince',
      expect.objectContaining({ importSince: expect.any(Date) }),
    );
  });

  it("serializes connection operations without token or secret fields", async () => {
    const connection = {
      id: "connection-1",
      userId: "user-1",
      provider: "spotify",
      status: "connected",
      accountName: "Listener",
      providerUserId: "spotify-user",
      encryptedAccessToken: "must-not-leak",
      encryptedRefreshToken: "must-not-leak",
      accessTokenExpiresAt: new Date("2026-08-21T00:00:00.000Z"),
      lastSyncedAt: new Date("2026-08-14T00:00:00.000Z"),
      lastErrorCode: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-14T00:00:00.000Z"),
    };
    const listQb = chain({
      getCount: jest.fn().mockResolvedValue(1),
      getRawAndEntities: jest.fn().mockResolvedValue({
        entities: [connection],
        raw: [{ userFullName: "Test Listener" }],
      }),
    });
    const service = new AdminMusicService(
      { createQueryBuilder: jest.fn().mockReturnValue(listQb) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.list({ page: 1, pageSize: 20 });
    const serialized = result.records[0] as unknown as Record<string, unknown>;

    expect(serialized).toEqual(expect.objectContaining({
      userId: "user-1",
      provider: "spotify",
      tokenExpiresAt: "2026-08-21T00:00:00.000Z",
    }));
    expect(serialized).not.toHaveProperty("encryptedAccessToken");
    expect(serialized).not.toHaveProperty("encryptedRefreshToken");
    expect(serialized).not.toHaveProperty("accessToken");
    expect(serialized).not.toHaveProperty("refreshToken");
    expect(listQb.addSelect).toHaveBeenCalledWith("user.fullName", "userFullName");
    expect(listQb.orderBy).toHaveBeenCalledWith("connection.updatedAt", "DESC");
  });
});
