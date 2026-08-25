import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { Spotlight } from "../../entities/spotlight.entity";
import { AnalyticsService, ANALYTICS_EVENTS } from "../analytics/analytics.service";

@Injectable()
export class SpotlightService {
  constructor(
    @InjectRepository(Spotlight)
    private readonly repo: Repository<Spotlight>,
    private readonly analytics: AnalyticsService,
  ) {}

  async getActiveSpotlights() {
    const now = new Date();
    const filtered = await this.repo.createQueryBuilder("spotlight")
      .where("spotlight.status IN (:...statuses)", { statuses: ["active", "scheduled"] })
      .andWhere("(spotlight.startsAt IS NULL OR spotlight.startsAt <= :now)", { now: now.toISOString() })
      .andWhere("(spotlight.expiresAt IS NULL OR spotlight.expiresAt > :now)", { now: now.toISOString() })
      .orderBy("spotlight.priority", "ASC")
      .addOrderBy("spotlight.createdAt", "DESC")
      .take(10)
      .getMany();

    return {
      items: filtered.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle ?? null,
        artist: item.artist,
        song: item.song ?? null,
        albumArt: item.albumArt,
        backgroundImage: item.backgroundImage ?? null,
        campaignType: item.campaignType,
        buttonLabel: item.buttonLabel ?? null,
        tag: item.tag,
        deepLink: item.deepLink,
        priority: item.priority,
        expiresAt: item.expiresAt?.toISOString(),
      })),
      rotateIntervalMs: 6000,
    };
  }

  async trackImpression(id: string) {
    await this.incrementEligibleMetric(id, "impressionCount");
    await this.analytics.track(ANALYTICS_EVENTS.SPOTLIGHT_VIEWED, { properties: { spotlightId: id }, source: "mobile" });
    return { ok: true as const };
  }

  async trackTap(id: string) {
    await this.incrementEligibleMetric(id, "tapCount");
    await this.analytics.track(ANALYTICS_EVENTS.SPOTLIGHT_CLICKED, { properties: { spotlightId: id }, source: "mobile" });
    return { ok: true as const };
  }

  private async incrementEligibleMetric(id: string, metric: "impressionCount" | "tapCount") {
    const now = new Date().toISOString();
    const result = await this.repo.createQueryBuilder()
      .update(Spotlight)
      .set({ [metric]: () => `"${metric}" + 1` })
      .where("id = :id", { id })
      .andWhere("status IN (:...statuses)", { statuses: ["active", "scheduled"] })
      .andWhere("(\"startsAt\" IS NULL OR \"startsAt\" <= :now)", { now })
      .andWhere("(\"expiresAt\" IS NULL OR \"expiresAt\" > :now)", { now })
      .execute();
    if (result.affected === 0) throw new NotFoundException("Active spotlight not found");
  }
}
