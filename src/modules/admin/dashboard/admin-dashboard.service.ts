import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { isRedisReady, REDIS_CLIENT } from "../../../common/modules/redis.module";
import { AdminDashboardQueryDto, DashboardRangePreset } from "./admin-dashboard-query.dto";

type NumericRow = Record<string, string | number | null>;
type SeriesPoint = { date: string; value: number };
type MultiSeriesPoint = { date: string; [key: string]: string | number };
type DistributionPoint = { name: string; value: number };

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 45_000;
const MAX_CUSTOM_RANGE_MS = 366 * DAY_MS;

@Injectable()
export class AdminDashboardService {
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: { status?: string } | null,
  ) {}

  async getOverview(query: AdminDashboardQueryDto) {
    const range = this.resolveRange(query);
    const cacheKey = range.preset === "custom"
      ? `${range.preset}:${range.from.toISOString()}:${range.to.toISOString()}`
      : range.preset;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + DAY_MS);
    const yesterday = new Date(today.getTime() - DAY_MS);
    const last24Hours = new Date(now.getTime() - DAY_MS);
    const previous24Hours = new Date(now.getTime() - 2 * DAY_MS);

    const [
      snapshotRows,
      userGrowthRows,
      userDistributionRows,
      repitGrowthRows,
      repitStatusRows,
      topTemplateRows,
      spotlightRows,
      supportTrendRows,
      supportStatusRows,
      moderationRows,
      moderationTrendRows,
      musicRows,
      authenticationRows,
      databaseHealthy,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT
          (SELECT COUNT(*) FROM users) AS "totalUsers",
          (SELECT COUNT(*) FROM users WHERE "lastLoginAt" >= $5) AS "activeUsers24h",
          (SELECT COUNT(*) FROM users WHERE "lastLoginAt" >= $6 AND "lastLoginAt" < $5) AS "previousActiveUsers24h",
          (SELECT COUNT(*) FROM users WHERE "createdAt" >= $7 AND "createdAt" < $8) AS "newUsersToday",
          (SELECT COUNT(*) FROM users WHERE "createdAt" >= $9 AND "createdAt" < $7) AS "newUsersYesterday",
          (SELECT COUNT(*) FROM users WHERE "createdAt" >= $1 AND "createdAt" < $2) AS "newUsersCurrent",
          (SELECT COUNT(*) FROM users WHERE "createdAt" >= $3 AND "createdAt" < $4) AS "newUsersPrevious",
          (SELECT COUNT(*) FROM repits) AS "totalRepits",
          (SELECT COUNT(*) FROM repits WHERE "createdAt" >= $7 AND "createdAt" < $8) AS "repitsToday",
          (SELECT COUNT(*) FROM repits WHERE "createdAt" >= $9 AND "createdAt" < $7) AS "repitsYesterday",
          (SELECT COUNT(*) FROM repits WHERE status = 'draft' AND "deletedByAdminAt" IS NULL) AS "draftRepits",
          (SELECT COUNT(*) FROM repits WHERE status = 'published' AND "deletedByAdminAt" IS NULL) AS "publishedRepits",
          (SELECT COUNT(DISTINCT r.id) FROM repits r LEFT JOIN repit_moderation_reports mr ON mr."repitId" = r.id WHERE r."moderationStatus" IN ('reported','under_review','restricted') OR mr.status IN ('open','under_review','escalated')) AS "reportedRepits",
          (SELECT COUNT(*) FROM templates WHERE status = 'published') AS "publishedTemplates",
          (SELECT COUNT(*) FROM spotlights WHERE status = 'active' AND ("startsAt" IS NULL OR "startsAt" <= NOW()) AND ("expiresAt" IS NULL OR "expiresAt" > NOW())) AS "activeSpotlights",
          (SELECT COUNT(*) FROM contact_submissions WHERE status IN ('new','open','assigned','waiting_for_customer','waiting_for_internal','escalated','reopened')) AS "openSupportTickets",
          (SELECT COUNT(*) FROM repit_moderation_reports WHERE status IN ('open','under_review','escalated')) AS "moderationQueue",
          (SELECT COUNT(*) FROM repits WHERE "createdAt" >= $1 AND "createdAt" < $2) AS "repitsCurrent",
          (SELECT COUNT(*) FROM repits WHERE "createdAt" >= $3 AND "createdAt" < $4) AS "repitsPrevious"`,
        [range.from, range.to, range.previousFrom, range.previousTo, last24Hours, previous24Hours, today, tomorrow, yesterday],
      ),
      this.groupedCount("users", "createdAt", range),
      this.dataSource.query(
        `SELECT CASE
          WHEN "isSuspended" = TRUE THEN 'Suspended'
          WHEN "emailVerified" = FALSE THEN 'Pending verification'
          ELSE 'Active'
        END AS name, COUNT(*) AS value
        FROM users GROUP BY 1 ORDER BY value DESC`,
      ),
      this.groupedCount("repits", "createdAt", range),
      this.dataSource.query(
        `SELECT CASE
          WHEN "deletedByAdminAt" IS NOT NULL THEN 'Deleted'
          WHEN "archivedAt" IS NOT NULL OR status = 'archived' THEN 'Archived'
          WHEN "moderationStatus" IN ('reported','under_review','restricted') THEN 'Reported'
          WHEN status = 'published' THEN 'Published'
          ELSE 'Draft'
        END AS name, COUNT(*) AS value
        FROM repits WHERE "createdAt" >= $1 AND "createdAt" < $2
        GROUP BY 1 ORDER BY value DESC`,
        [range.from, range.to],
      ),
      this.dataSource.query(
        `SELECT COALESCE(t.name, r."templateId") AS name, COUNT(*) AS value
         FROM repits r LEFT JOIN templates t ON t.id = r."templateId"
         WHERE r."createdAt" >= $1 AND r."createdAt" < $2
         GROUP BY COALESCE(t.name, r."templateId") ORDER BY value DESC LIMIT 8`,
        [range.from, range.to],
      ),
      this.dataSource.query(
        `SELECT status AS name, COUNT(*) AS value,
          COALESCE(SUM("impressionCount"), 0) AS impressions,
          COALESCE(SUM("tapCount"), 0) AS clicks
         FROM spotlights GROUP BY status ORDER BY value DESC`,
      ),
      this.dataSource.query(
        `SELECT date_trunc($3::text, "createdAt") AS bucket,
          COUNT(*) AS "new",
          COUNT(*) FILTER (WHERE status IN ('resolved','closed')) AS closed,
          COUNT(*) FILTER (WHERE status = 'escalated') AS escalated,
          COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed')) AS pending
         FROM contact_submissions WHERE "createdAt" >= $1 AND "createdAt" < $2
         GROUP BY 1 ORDER BY 1`,
        [range.from, range.to, range.granularity],
      ),
      this.dataSource.query(
        `SELECT status AS name, COUNT(*) AS value,
          (SELECT AVG(EXTRACT(EPOCH FROM (resolved."resolvedAt" - resolved."createdAt")) / 3600)
           FROM contact_submissions resolved
           WHERE resolved."createdAt" >= $1 AND resolved."createdAt" < $2 AND resolved."resolvedAt" IS NOT NULL) AS "averageResolutionHours"
         FROM contact_submissions
         WHERE "createdAt" >= $1 AND "createdAt" < $2
         GROUP BY status ORDER BY value DESC`,
        [range.from, range.to],
      ),
      this.dataSource.query(
        `SELECT name, SUM(value)::bigint AS value FROM (
          SELECT CASE WHEN status IN ('open','under_review','escalated') THEN 'Pending' ELSE 'Resolved' END AS name, COUNT(*) AS value
          FROM repit_moderation_reports WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY 1
          UNION ALL
          SELECT CASE WHEN action = 'dismiss' THEN 'Dismissed' WHEN action IN ('archive','remove') THEN 'Removed' ELSE 'Escalated' END AS name, COUNT(*) AS value
          FROM repit_moderation_decisions WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY 1
        ) moderation GROUP BY name ORDER BY value DESC`,
        [range.from, range.to],
      ),
      this.dataSource.query(
        `SELECT date_trunc($3::text, "createdAt") AS bucket, COUNT(*) AS value
         FROM repit_moderation_reports WHERE "createdAt" >= $1 AND "createdAt" < $2
         GROUP BY 1 ORDER BY 1`,
        [range.from, range.to, range.granularity],
      ),
      this.dataSource.query(
        `SELECT CASE
          WHEN LOWER(platform) = 'spotify' THEN 'Spotify'
          WHEN LOWER(platform) IN ('apple-music','apple_music','apple') THEN 'Apple Music'
          WHEN LOWER(platform) IN ('manual','upload','manual-upload') THEN 'Manual upload'
          ELSE 'Unknown'
        END AS name, COUNT(*) AS value
        FROM repits WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY 1 ORDER BY value DESC`,
        [range.from, range.to],
      ),
      this.dataSource.query(
        `SELECT date_trunc($3::text, "createdAt") AS bucket,
          COUNT(*) FILTER (WHERE action = 'admin.auth.login.succeeded') AS successful,
          COUNT(*) FILTER (WHERE action IN ('admin.auth.login.failed','admin.auth.login.blocked','admin.auth.mfa.failed')) AS failed
         FROM admin_audit_logs WHERE "createdAt" >= $1 AND "createdAt" < $2
         GROUP BY 1 ORDER BY 1`,
        [range.from, range.to, range.granularity],
      ),
      this.checkDatabase(),
    ]);

    const snapshot = (snapshotRows[0] ?? {}) as NumericRow;
    const spotlightStatus = this.toDistribution(spotlightRows);
    const impressions = spotlightRows.reduce((sum: number, row: NumericRow) => sum + this.number(row.impressions), 0);
    const clicks = spotlightRows.reduce((sum: number, row: NumericRow) => sum + this.number(row.clicks), 0);
    const averageResolutionHours = supportStatusRows.reduce((value: number | null, row: NumericRow) => {
      const next = row.averageResolutionHours;
      return next === null ? value : this.number(next);
    }, null);

    const response = {
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
      range: {
        preset: range.preset,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        previousFrom: range.previousFrom.toISOString(),
        previousTo: range.previousTo.toISOString(),
        granularity: range.granularity,
        label: range.label,
      },
      kpis: [
        this.kpi("total-users", "Total Users", snapshot.totalUsers, snapshot.newUsersCurrent, snapshot.newUsersPrevious, "Lifetime accounts; trend uses registrations in the selected period."),
        this.kpi("active-users", "Active Users (24 hours)", snapshot.activeUsers24h, snapshot.activeUsers24h, snapshot.previousActiveUsers24h, "Based on persisted last login time."),
        this.kpi("new-users-today", "New Users Today", snapshot.newUsersToday, snapshot.newUsersToday, snapshot.newUsersYesterday, "Compared with yesterday."),
        this.kpi("total-repits", "Total Repits", snapshot.totalRepits, snapshot.repitsCurrent, snapshot.repitsPrevious, "Lifetime Repits; trend uses creation in the selected period."),
        this.kpi("repits-today", "Repits Created Today", snapshot.repitsToday, snapshot.repitsToday, snapshot.repitsYesterday, "Compared with yesterday."),
        this.kpi("draft-repits", "Draft Repits", snapshot.draftRepits, null, null, "Current non-deleted drafts."),
        this.kpi("published-repits", "Published Repits", snapshot.publishedRepits, null, null, "Current non-deleted published Repits."),
        this.kpi("reported-repits", "Reported Repits", snapshot.reportedRepits, null, null, "Distinct Repits with active moderation signals."),
        this.kpi("published-templates", "Templates Published", snapshot.publishedTemplates, null, null, "Templates currently available to users."),
        this.kpi("active-spotlights", "Active Spotlight Campaigns", snapshot.activeSpotlights, null, null, "Active within their configured schedule."),
        this.kpi("open-support", "Open Support Tickets", snapshot.openSupportTickets, null, null, "All unresolved operational support states."),
        this.kpi("moderation-queue", "Moderation Queue Size", snapshot.moderationQueue, null, null, "Open, under-review, or escalated reports."),
        { id: "storage", label: "Storage Consumed", value: null, formattedValue: "Unavailable", available: false, changePercent: null, trend: "flat", comparisonLabel: null, helper: "Storage byte usage is not persisted by the current platform." },
        { id: "api-health", label: "API Health Status", value: databaseHealthy ? 1 : 0, formattedValue: databaseHealthy ? "Healthy" : "Critical", available: true, changePercent: null, trend: "flat", comparisonLabel: null, helper: databaseHealthy ? "API and PostgreSQL probe passed." : "PostgreSQL probe failed." },
      ],
      users: {
        growth: this.series(userGrowthRows),
        distribution: this.toDistribution(userDistributionRows),
        activeSnapshot: {
          daily: this.number(snapshot.activeUsers24h),
          weekly: await this.countSince("users", "lastLoginAt", new Date(now.getTime() - 7 * DAY_MS)),
          monthly: await this.countSince("users", "lastLoginAt", new Date(now.getTime() - 30 * DAY_MS)),
          historicalSeriesAvailable: false,
          note: "DAU/WAU/MAU are current snapshots. Historical login events are not retained for consumer users.",
        },
      },
      repits: {
        created: this.series(repitGrowthRows),
        status: this.toDistribution(repitStatusRows),
        topTemplates: this.withPercent(topTemplateRows),
        exports: { available: false, points: [], note: "Export events and output formats are not persisted." },
      },
      spotlight: {
        status: spotlightStatus,
        summary: { impressions, clicks, clickThroughRate: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0 },
        performance: { available: false, points: [], note: "Campaign totals are persisted, but timestamped impression and click events are not." },
      },
      support: {
        trend: this.multiSeries(supportTrendRows, ["new", "closed", "escalated", "pending"]),
        status: this.toDistribution(supportStatusRows),
        averageResolutionHours: averageResolutionHours === null ? null : Number(averageResolutionHours.toFixed(1)),
      },
      moderation: {
        breakdown: this.toDistribution(moderationRows),
        trend: this.series(moderationTrendRows),
        note: "Approved is not an existing decision state; the chart reports persisted pending, resolved, removed, dismissed, and escalated outcomes.",
      },
      music: { distribution: this.toDistribution(musicRows) },
      storage: {
        available: false,
        breakdown: [],
        growth: [],
        note: "The platform does not persist object sizes or storage inventory snapshots.",
      },
      authentication: {
        points: authenticationRows.map((row: NumericRow) => ({
          date: this.iso(row.bucket),
          successfulLogins: this.number(row.successful),
          failedLogins: this.number(row.failed),
        })),
        scope: "Admin authentication only",
        note: "Consumer login and password-reset event history is not currently persisted.",
      },
      health: this.health(databaseHealthy),
      availability: [
        { dataset: "User growth", available: true, source: "users.createdAt" },
        { dataset: "Repit creation and status", available: true, source: "repits" },
        { dataset: "Spotlight totals", available: true, source: "spotlights counters" },
        { dataset: "Export activity", available: false, source: null },
        { dataset: "Storage utilization", available: false, source: null },
        { dataset: "Historical consumer activity", available: false, source: null },
      ],
    };

    this.remember(cacheKey, response);
    return response;
  }

  private resolveRange(query: AdminDashboardQueryDto) {
    const preset: DashboardRangePreset = query.range ?? "30d";
    const now = new Date();
    let from: Date;
    let to = now;
    let label: string;

    if (preset === "custom") {
      if (!query.from || !query.to) throw new BadRequestException("Custom dashboard ranges require both from and to dates.");
      from = new Date(query.from);
      to = new Date(query.to);
      if (to <= from) throw new BadRequestException("Dashboard range end must be after its start.");
      if (to.getTime() - from.getTime() > MAX_CUSTOM_RANGE_MS) throw new BadRequestException("Dashboard ranges cannot exceed 366 days.");
      label = "Custom range";
    } else if (preset === "today") {
      from = new Date(now);
      from.setUTCHours(0, 0, 0, 0);
      label = "Today";
    } else if (preset === "year") {
      from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      label = "This year";
    } else {
      const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
      from = new Date(now.getTime() - days * DAY_MS);
      label = `Last ${days} days`;
    }

    const duration = to.getTime() - from.getTime();
    const granularity = duration <= 2 * DAY_MS ? "hour" : duration <= 120 * DAY_MS ? "day" : "month";
    return {
      preset,
      from,
      to,
      previousFrom: new Date(from.getTime() - duration),
      previousTo: from,
      granularity,
      label,
    };
  }

  private async groupedCount(table: "users" | "repits", column: "createdAt", range: { from: Date; to: Date; granularity: string }) {
    return this.dataSource.query(
      `SELECT date_trunc($3::text, "${column}") AS bucket, COUNT(*) AS value
       FROM ${table} WHERE "${column}" >= $1 AND "${column}" < $2 GROUP BY 1 ORDER BY 1`,
      [range.from, range.to, range.granularity],
    );
  }

  private async countSince(table: "users", column: "lastLoginAt", since: Date) {
    const rows = await this.dataSource.query(`SELECT COUNT(*) AS value FROM ${table} WHERE "${column}" >= $1`, [since]);
    return this.number(rows[0]?.value);
  }

  private async checkDatabase() {
    try {
      await this.dataSource.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  private health(databaseHealthy: boolean) {
    const configured = (keys: string[]) => keys.some((key) => Boolean(this.config.get<string>(key)));
    const unprobed = (id: string, label: string, isConfigured: boolean) => ({
      id,
      label,
      status: "warning" as const,
      available: false,
      detail: isConfigured ? "Configured, but no active health probe is available." : "Not configured in this environment.",
    });
    return [
      { id: "api", label: "API", status: databaseHealthy ? "healthy" : "critical", available: true, detail: databaseHealthy ? "Dashboard request and database probe succeeded." : "Database probe failed." },
      { id: "postgresql", label: "PostgreSQL", status: databaseHealthy ? "healthy" : "critical", available: true, detail: databaseHealthy ? "Connection probe succeeded." : "Connection probe failed." },
      { id: "redis", label: "Redis", status: isRedisReady(this.redis) ? "healthy" : "warning", available: true, detail: isRedisReady(this.redis) ? "Shared cache client is ready." : "Unavailable; services are using documented in-memory fallbacks." },
      unprobed("email", "Email", configured(["SMTP_HOST", "RESEND_API_KEY"])),
      unprobed("push", "Push Notifications", configured(["EXPO_ACCESS_TOKEN"])),
      unprobed("storage", "Storage", configured(["AWS_S3_BUCKET", "S3_BUCKET", "CLOUDINARY_URL"])),
      unprobed("workers", "Background Workers", configured(["QUEUE_URL", "REDIS_URL"])),
    ];
  }

  private kpi(id: string, label: string, value: unknown, current: unknown, previous: unknown, helper: string) {
    const numericValue = this.number(value);
    const change = current === null || previous === null ? null : this.change(this.number(current), this.number(previous));
    return {
      id,
      label,
      value: numericValue,
      formattedValue: numericValue.toLocaleString("en-US"),
      available: true,
      changePercent: change,
      trend: change === null || change === 0 ? "flat" : change > 0 ? "up" : "down",
      comparisonLabel: change === null ? null : "vs previous period",
      helper,
    };
  }

  private change(current: number, previous: number) {
    if (previous === 0) return current === 0 ? 0 : 100;
    return Number((((current - previous) / previous) * 100).toFixed(1));
  }

  private series(rows: NumericRow[]): SeriesPoint[] {
    return rows.map((row) => ({ date: this.iso(row.bucket), value: this.number(row.value) }));
  }

  private multiSeries(rows: NumericRow[], keys: string[]): MultiSeriesPoint[] {
    return rows.map((row) => Object.fromEntries([["date", this.iso(row.bucket)], ...keys.map((key) => [key, this.number(row[key])])]) as MultiSeriesPoint);
  }

  private toDistribution(rows: NumericRow[]): DistributionPoint[] {
    return rows.map((row) => ({ name: String(row.name ?? "Unknown"), value: this.number(row.value) }));
  }

  private withPercent(rows: NumericRow[]) {
    const total = rows.reduce((sum, row) => sum + this.number(row.value), 0);
    return rows.map((row) => ({ name: String(row.name ?? "Unknown"), value: this.number(row.value), percentage: total ? Number(((this.number(row.value) / total) * 100).toFixed(1)) : 0 }));
  }

  private number(value: unknown) {
    const result = Number(value ?? 0);
    return Number.isFinite(result) ? result : 0;
  }

  private iso(value: unknown) {
    return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
  }

  private remember(key: string, value: unknown) {
    if (this.cache.size >= 50) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  }
}
