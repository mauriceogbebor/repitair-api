import { NotFoundException } from "@nestjs/common";
import { SpotlightService } from "./spotlight.service";

function queryBuilder(overrides: Record<string, unknown> = {}) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ["where", "andWhere", "orderBy", "addOrderBy", "take", "update", "set"]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  Object.assign(qb, overrides);
  return qb;
}

describe("SpotlightService", () => {
  it("delivers active and due scheduled campaigns with the full mobile contract", async () => {
    const campaign = {
      id: "spotlight-1",
      title: "New release",
      subtitle: "Listen now",
      artist: "Artist",
      song: "Song",
      albumArt: "https://cdn.example/art.jpg",
      backgroundImage: "https://cdn.example/background.jpg",
      campaignType: "release",
      buttonLabel: "Open release",
      tag: "NEW_SINGLE",
      deepLink: "repitair://spotlight/legacy-release",
      priority: 2,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    };
    const qb = queryBuilder({ getMany: jest.fn().mockResolvedValue([campaign]) });
    const service = new SpotlightService(
      { createQueryBuilder: jest.fn().mockReturnValue(qb) } as never,
      { track: jest.fn() } as never,
    );

    const result = await service.getActiveSpotlights();

    expect(qb.where).toHaveBeenCalledWith(
      "spotlight.status IN (:...statuses)",
      { statuses: ["active", "scheduled"] },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      "(spotlight.startsAt IS NULL OR spotlight.startsAt <= :now)",
      expect.objectContaining({ now: expect.any(String) }),
    );
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: "spotlight-1",
      subtitle: "Listen now",
      song: "Song",
      backgroundImage: "https://cdn.example/background.jpg",
      campaignType: "release",
      buttonLabel: "Create Repit",
      deepLink: "/create/pick-template?fresh=1",
    }));
  });

  it.each(["impressionCount", "tapCount"] as const)(
    "increments %s only for a currently deliverable campaign",
    async (metric) => {
      const qb = queryBuilder({ execute: jest.fn().mockResolvedValue({ affected: 1 }) });
      const analytics = { track: jest.fn().mockResolvedValue(undefined) };
      const service = new SpotlightService(
        { createQueryBuilder: jest.fn().mockReturnValue(qb) } as never,
        analytics as never,
      );

      if (metric === "impressionCount") await service.trackImpression("spotlight-1");
      else await service.trackTap("spotlight-1");

      expect(qb.set).toHaveBeenCalledWith({ [metric]: expect.any(Function) });
      expect(qb.andWhere).toHaveBeenCalledWith(
        "status IN (:...statuses)",
        { statuses: ["active", "scheduled"] },
      );
      expect(analytics.track).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects metrics for campaigns that are not currently deliverable", async () => {
    const qb = queryBuilder({ execute: jest.fn().mockResolvedValue({ affected: 0 }) });
    const analytics = { track: jest.fn() };
    const service = new SpotlightService(
      { createQueryBuilder: jest.fn().mockReturnValue(qb) } as never,
      analytics as never,
    );

    await expect(service.trackImpression("inactive")).rejects.toBeInstanceOf(NotFoundException);
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
