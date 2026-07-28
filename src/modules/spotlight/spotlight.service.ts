import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThanOrEqual, MoreThanOrEqual, IsNull, Or, Repository } from "typeorm";

import { Spotlight } from "../../entities/spotlight.entity";
import { AnalyticsService, ANALYTICS_EVENTS } from "../analytics/analytics.service";
import { CreateSpotlightDto } from "./dto/create-spotlight.dto";
import { UpdateSpotlightDto } from "./dto/update-spotlight.dto";

@Injectable()
export class SpotlightService {
  constructor(
    @InjectRepository(Spotlight)
    private readonly repo: Repository<Spotlight>,
    private readonly analytics: AnalyticsService,
  ) {}

  async getActiveSpotlights() {
    const now = new Date();

    const filtered = await this.repo.find({
      where: {
        status: "active" as const,
        startsAt: Or(IsNull(), LessThanOrEqual(now)),
        expiresAt: Or(IsNull(), MoreThanOrEqual(now)),
      },
      order: { priority: "ASC", createdAt: "DESC" },
      take: 10,
    });

    return {
      items: filtered.map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.artist,
        albumArt: item.albumArt,
        tag: item.tag,
        deepLink: item.deepLink,
        priority: item.priority,
        expiresAt: item.expiresAt?.toISOString(),
      })),
      rotateIntervalMs: 6000,
    };
  }

  async trackImpression(id: string) {
    const result = await this.repo.increment({ id }, "impressionCount", 1);
    if (result.affected === 0) {
      throw new NotFoundException("Spotlight not found");
    }
    await this.analytics.track(ANALYTICS_EVENTS.SPOTLIGHT_VIEWED, { properties: { spotlightId: id }, source: "mobile" });
    return { ok: true as const };
  }

  async findAll(options: { limit?: number; offset?: number } = {}) {
    const take = Math.min(options.limit ?? 50, 100);
    const skip = Math.max(options.offset ?? 0, 0);
    const [data, total] = await this.repo.findAndCount({
      order: { priority: "ASC", createdAt: "DESC" },
      take,
      skip,
    });
    return { data, total, limit: take, offset: skip };
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException("Spotlight not found");
    return item;
  }

  async create(dto: CreateSpotlightDto) {
    const spotlight = this.repo.create({
      ...dto,
      status: "draft",
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });
    return this.repo.save(spotlight);
  }

  async update(id: string, dto: UpdateSpotlightDto) {
    const spotlight = await this.findOne(id);
    Object.assign(spotlight, {
      ...dto,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : spotlight.startsAt,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : spotlight.expiresAt,
    });
    return this.repo.save(spotlight);
  }

  async remove(id: string) {
    const spotlight = await this.findOne(id);
    await this.repo.remove(spotlight);
    return { ok: true as const };
  }
}
