import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { AdminAnalyticsQueryDto, AnalyticsRangePreset } from "./admin-analytics-query.dto";

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 60_000;
const MAX_CUSTOM_RANGE_MS = 366 * DAY_MS;

type Row = Record<string, string | number | null>;

/** Safe numeric coercion — DB COUNT/AVG come back as strings or null. */
function n(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** Ratio in [0,1] or null when the denominator is zero (honest "no data"). */
function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Product-analytics aggregation over the append-only analytics_events log.
 *
 * Everything here is derived from real emitted events (never fabricated). When
 * an event stream is empty for the window, values are zero / null and the client
 * shows a "collecting data" state rather than inventing history.
 */
@Injectable()
export class AdminAnalyticsService {
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(private readonly dataSource: DataSource) {}

  async getOverview(query: AdminAnalyticsQueryDto) {
    const range = this.resolveRange(query);
    const cacheKey = range.preset === "custom"
      ? `custom:${range.from.toISOString()}:${range.to.toISOString()}`
      : range.preset;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const [funnel, templates, retention, providers, trend] = await Promise.all([
      this.funnel(range),
      this.templates(range),
      this.retention(),
      this.providers(range),
      this.trend(range),
    ]);

    const value = {
      range: { preset: range.preset, from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
      funnel,
      templates,
      retention,
      providers,
      trend,
      generatedAt: new Date().toISOString(),
    };
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  }

  /** Registration → first-repit → publish conversion, at user and repit grain. */
  private async funnel(range: { from: Date; to: Date }) {
    const [row] = (await this.dataSource.query(
      `SELECT
        (SELECT COUNT(*) FROM analytics_events WHERE name='user.registered' AND "occurredAt">=$1 AND "occurredAt"<$2) AS registered,
        (SELECT COUNT(*) FROM analytics_events WHERE name='user.login' AND "occurredAt">=$1 AND "occurredAt"<$2) AS logins,
        (SELECT COUNT(DISTINCT "userId") FROM analytics_events WHERE name='repit.created' AND "occurredAt">=$1 AND "occurredAt"<$2) AS creators,
        (SELECT COUNT(*) FROM analytics_events WHERE name='repit.created' AND "occurredAt">=$1 AND "occurredAt"<$2) AS "repitsCreated",
        (SELECT COUNT(DISTINCT "userId") FROM analytics_events WHERE name='repit.published' AND "occurredAt">=$1 AND "occurredAt"<$2) AS publishers,
        (SELECT COUNT(*) FROM analytics_events WHERE name='repit.published' AND "occurredAt">=$1 AND "occurredAt"<$2) AS "repitsPublished"`,
      [range.from, range.to],
    )) as Row[];

    const registered = n(row?.registered);
    const creators = n(row?.creators);
    const repitsCreated = n(row?.repitsCreated);
    const publishers = n(row?.publishers);
    const repitsPublished = n(row?.repitsPublished);

    return {
      stages: [
        { key: "registered", label: "Registered", value: registered },
        { key: "creators", label: "Created a repit", value: creators },
        { key: "publishers", label: "Published a repit", value: publishers },
      ],
      logins: n(row?.logins),
      repitsCreated,
      repitsPublished,
      rates: {
        registeredToCreator: ratio(creators, registered),
        creatorToPublisher: ratio(publishers, creators),
        createToPublish: ratio(repitsPublished, repitsCreated),
      },
    };
  }

  /** Per-template adoption and drop-off (created vs published), top 20 by volume. */
  private async templates(range: { from: Date; to: Date }) {
    const rows = (await this.dataSource.query(
      `SELECT
        e.properties->>'templateId' AS "templateId",
        COALESCE(t.name, e.properties->>'templateId') AS name,
        COUNT(*) FILTER (WHERE e.name='repit.created') AS created,
        COUNT(*) FILTER (WHERE e.name='repit.published') AS published
      FROM analytics_events e
      LEFT JOIN templates t ON t.id::text = e.properties->>'templateId'
      WHERE e.name IN ('repit.created','repit.published')
        AND e."occurredAt">=$1 AND e."occurredAt"<$2
        AND e.properties->>'templateId' IS NOT NULL
      GROUP BY 1, 2
      ORDER BY created DESC
      LIMIT 20`,
      [range.from, range.to],
    )) as Row[];

    return rows.map((r) => {
      const created = n(r.created);
      const published = n(r.published);
      return {
        templateId: String(r.templateId ?? ""),
        name: String(r.name ?? r.templateId ?? "Unknown"),
        created,
        published,
        conversion: ratio(published, created),
      };
    });
  }

  /** Weekly signup cohorts × return-login retention, last 8 cohorts, offsets 0–4. */
  private async retention() {
    const rows = (await this.dataSource.query(
      `WITH cohorts AS (
        SELECT "userId", date_trunc('week', MIN("occurredAt")) AS cohort_week
        FROM analytics_events
        WHERE name='user.registered' AND "userId" IS NOT NULL
        GROUP BY "userId"
      ),
      recent AS (
        SELECT DISTINCT cohort_week FROM cohorts ORDER BY cohort_week DESC LIMIT 8
      ),
      activity AS (
        SELECT c."userId", c.cohort_week,
          floor(EXTRACT(EPOCH FROM (date_trunc('week', a."occurredAt") - c.cohort_week)) / 604800)::int AS week_offset
        FROM cohorts c
        JOIN recent r ON r.cohort_week = c.cohort_week
        JOIN analytics_events a ON a."userId" = c."userId" AND a.name='user.login'
      )
      SELECT c.cohort_week AS cohort, COUNT(DISTINCT c."userId") AS size,
        COUNT(DISTINCT a."userId") FILTER (WHERE a.week_offset=1) AS w1,
        COUNT(DISTINCT a."userId") FILTER (WHERE a.week_offset=2) AS w2,
        COUNT(DISTINCT a."userId") FILTER (WHERE a.week_offset=3) AS w3,
        COUNT(DISTINCT a."userId") FILTER (WHERE a.week_offset=4) AS w4
      FROM cohorts c
      JOIN recent r ON r.cohort_week = c.cohort_week
      LEFT JOIN activity a ON a."userId" = c."userId"
      GROUP BY c.cohort_week
      ORDER BY c.cohort_week DESC`,
    )) as Row[];

    return rows.map((r) => {
      const size = n(r.size);
      return {
        cohort: r.cohort ? new Date(r.cohort as string).toISOString() : null,
        size,
        weeks: [
          ratio(n(r.w1), size),
          ratio(n(r.w2), size),
          ratio(n(r.w3), size),
          ratio(n(r.w4), size),
        ],
      };
    });
  }

  /** Music-connect volume by provider + background-removal success & latency. */
  private async providers(range: { from: Date; to: Date }) {
    const [music] = (await this.dataSource.query(
      `SELECT
        COUNT(*) FILTER (WHERE name='music.spotify_connected') AS spotify,
        COUNT(*) FILTER (WHERE name='music.apple_connected') AS apple,
        COUNT(*) FILTER (WHERE name='music.playlist_imported') AS imports,
        COUNT(*) FILTER (WHERE name='music.account_disconnected') AS disconnects
      FROM analytics_events WHERE name LIKE 'music.%' AND "occurredAt">=$1 AND "occurredAt"<$2`,
      [range.from, range.to],
    )) as Row[];

    const [media] = (await this.dataSource.query(
      `SELECT
        COUNT(*) FILTER (WHERE name='media.processing_started') AS started,
        COUNT(*) FILTER (WHERE name='media.processing_completed') AS completed,
        COUNT(*) FILTER (WHERE name='media.failed') AS failed,
        COUNT(*) FILTER (WHERE name='media.provider_timeout') AS timeouts,
        COUNT(*) FILTER (WHERE name='media.provider_error') AS errors,
        COUNT(*) FILTER (WHERE name='media.cache_hit') AS "cacheHits"
      FROM analytics_events WHERE name LIKE 'media.%' AND "occurredAt">=$1 AND "occurredAt"<$2`,
      [range.from, range.to],
    )) as Row[];

    const [latency] = (await this.dataSource.query(
      `SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY dur) AS p95,
        AVG(dur) AS avg,
        COUNT(*) AS samples
      FROM (
        SELECT EXTRACT(EPOCH FROM (MIN(c."occurredAt") - s."occurredAt")) AS dur
        FROM analytics_events s
        JOIN analytics_events c
          ON c.properties->>'assetId' = s.properties->>'assetId'
          AND c.name='media.processing_completed'
          AND c."occurredAt" >= s."occurredAt"
        WHERE s.name='media.processing_started'
          AND s."occurredAt">=$1 AND s."occurredAt"<$2
        GROUP BY s.id, s."occurredAt"
      ) d
      WHERE dur >= 0 AND dur < 600`,
      [range.from, range.to],
    )) as Row[];

    const completed = n(media?.completed);
    const failed = n(media?.failed) + n(media?.timeouts) + n(media?.errors);

    return {
      music: {
        spotifyConnected: n(music?.spotify),
        appleConnected: n(music?.apple),
        playlistsImported: n(music?.imports),
        disconnects: n(music?.disconnects),
      },
      backgroundRemoval: {
        started: n(media?.started),
        completed,
        failed,
        cacheHits: n(media?.cacheHits),
        successRate: ratio(completed, completed + failed),
        latencySeconds: {
          p50: latency?.p50 != null ? n(latency.p50) : null,
          p95: latency?.p95 != null ? n(latency.p95) : null,
          avg: latency?.avg != null ? n(latency.avg) : null,
          samples: n(latency?.samples),
        },
      },
    };
  }

  /** Daily created-vs-published series for the trend chart. */
  private async trend(range: { from: Date; to: Date; granularity: string }) {
    const rows = (await this.dataSource.query(
      `SELECT date_trunc($3::text, "occurredAt") AS bucket,
        COUNT(*) FILTER (WHERE name='repit.created') AS created,
        COUNT(*) FILTER (WHERE name='repit.published') AS published
      FROM analytics_events
      WHERE name IN ('repit.created','repit.published') AND "occurredAt">=$1 AND "occurredAt"<$2
      GROUP BY 1 ORDER BY 1`,
      [range.from, range.to, range.granularity],
    )) as Row[];

    return rows.map((r) => ({
      date: r.bucket ? new Date(r.bucket as string).toISOString() : "",
      created: n(r.created),
      published: n(r.published),
    }));
  }

  private resolveRange(query: AdminAnalyticsQueryDto) {
    const preset: AnalyticsRangePreset = query.range ?? "30d";
    const now = new Date();
    let from: Date;
    let to = now;
    let label: string;

    if (preset === "custom") {
      if (!query.from || !query.to) throw new BadRequestException("Custom analytics ranges require both from and to dates.");
      from = new Date(query.from);
      to = new Date(query.to);
      if (to <= from) throw new BadRequestException("Analytics range end must be after its start.");
      if (to.getTime() - from.getTime() > MAX_CUSTOM_RANGE_MS) throw new BadRequestException("Analytics ranges cannot exceed 366 days.");
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
    return { preset, from, to, granularity, label };
  }
}
