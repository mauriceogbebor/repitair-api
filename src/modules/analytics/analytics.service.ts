import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AnalyticsEvent } from "../../entities/analytics-event.entity";

/** Canonical Release-1 event names. Keep this list authoritative. */
export const ANALYTICS_EVENTS = {
  USER_REGISTERED: "user.registered",
  LOGIN: "user.login",
  REPIT_CREATED: "repit.created",
  REPIT_EXPORTED: "repit.exported",
  TEMPLATE_SELECTED: "template.selected",
  TEMPLATE_USED: "template.used",
  SPOTLIGHT_VIEWED: "spotlight.viewed",
  SPOTLIGHT_CLICKED: "spotlight.clicked",
  NOTIFICATION_SENT: "notification.sent",
  NOTIFICATION_DELIVERED: "notification.delivered",
  SUPPORT_CASE_CREATED: "support.case.created",
  SUPPORT_CASE_CLOSED: "support.case.closed",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(AnalyticsEvent)
    private readonly eventRepo: Repository<AnalyticsEvent>,
  ) {}

  /**
   * Record an event. Fire-and-forget: instrumentation must never break the
   * primary operation, so persistence errors are logged and swallowed.
   */
  async track(
    name: AnalyticsEventName | string,
    opts: { userId?: string | null; properties?: Record<string, unknown>; source?: string; occurredAt?: Date } = {},
  ): Promise<void> {
    try {
      const event = this.eventRepo.create({
        name,
        userId: opts.userId ?? null,
        properties: opts.properties ?? null,
        source: opts.source ?? "backend",
        occurredAt: opts.occurredAt ?? new Date(),
      });
      await this.eventRepo.save(event);
    } catch (err) {
      this.logger.warn(`Failed to record analytics event "${name}": ${(err as Error).message}`);
    }
  }

  /**
   * Aggregate a daily count for one event over a window — the honest basis for
   * future dashboards. Returns real rows only; callers show "Unavailable" when
   * empty rather than fabricating history.
   */
  async dailyCounts(name: string, sinceDays = 30): Promise<Array<{ day: string; count: number }>> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const rows = await this.eventRepo
      .createQueryBuilder("e")
      .select("date_trunc('day', e.occurredAt)", "day")
      .addSelect("COUNT(*)", "count")
      .where("e.name = :name", { name })
      .andWhere("e.occurredAt >= :since", { since })
      .groupBy("day")
      .orderBy("day", "ASC")
      .getRawMany<{ day: string; count: string }>();
    return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
  }
}
