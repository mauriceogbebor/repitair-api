import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { AnalyticsEvent } from "../../../entities/analytics-event.entity";
import { MediaAsset } from "../../../entities/media-asset.entity";
import { MediaDerivative } from "../../../entities/media-derivative.entity";
import { MediaProcessingService } from "../../media/media-processing.service";
import { costPerImage, roundCurrency } from "../../media/media-cost";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class AdminMediaService {
  constructor(
    @InjectRepository(MediaAsset) private readonly assets: Repository<MediaAsset>,
    @InjectRepository(MediaDerivative) private readonly derivatives: Repository<MediaDerivative>,
    @InjectRepository(AnalyticsEvent) private readonly analytics: Repository<AnalyticsEvent>,
    private readonly processing: MediaProcessingService,
  ) {}

  /** DB-aggregated monitoring overview — never a full in-memory scan. */
  async overview() {
    const statusRows = await this.assets.createQueryBuilder("a").select('a."processingStatus"', "status").addSelect("COUNT(*)", "count").groupBy('a."processingStatus"').getRawMany<{ status: string; count: string }>();
    const cards = { uploaded: 0, queued: 0, processing: 0, completed: 0, failed: 0, retry_required: 0, cancelled: 0 };
    for (const row of statusRows) if (row.status in cards) cards[row.status as keyof typeof cards] = Number(row.count);

    const durationRow = await this.derivatives.createQueryBuilder("d").select('AVG(d."processingDurationMs")', "avg").getRawOne<{ avg: string | null }>();
    const providerRows = await this.derivatives.createQueryBuilder("d").select("d.provider", "provider").addSelect("COUNT(*)", "count").groupBy("d.provider").getRawMany<{ provider: string; count: string }>();
    const retriesRow = await this.assets.createQueryBuilder("a").select('COALESCE(SUM(a."retryCount"), 0)', "total").getRawOne<{ total: string }>();
    const bytesRow = await this.assets.createQueryBuilder("a").select('AVG(a."bytes")', "avg").getRawOne<{ avg: string | null }>();

    const processed = await this.analytics.count({ where: { name: "media.processed" } });
    const cacheHits = await this.analytics.count({ where: { name: "media.cache_hit" } });
    const failures = await this.analytics.count({ where: { name: "media.failed" } });
    const totalRuns = processed + cacheHits;

    const cost = await this.costIntelligence();
    const providerHealth = await this.providerHealth();

    return {
      cards,
      averageProcessingMs: durationRow?.avg != null ? Math.round(Number(durationRow.avg)) : null,
      averageImageBytes: bytesRow?.avg != null ? Math.round(Number(bytesRow.avg)) : null,
      providerUsage: providerRows.map((r) => ({ provider: r.provider, count: Number(r.count) })),
      totalRetries: Number(retriesRow?.total ?? 0),
      cacheHitRate: totalRuns > 0 ? Math.round((cacheHits / totalRuns) * 100) : null,
      cacheMissRate: totalRuns > 0 ? Math.round((processed / totalRuns) * 100) : null,
      providerSuccessRate: processed + failures > 0 ? Math.round((processed / (processed + failures)) * 100) : null,
      imagesProcessed: processed,
      cacheHits,
      failures,
      cost,
      providerHealth,
    };
  }

  /**
   * Cost intelligence (WS9). A provider is only billed on a genuine call — cache
   * hits cost nothing — so spend is estimated from `media.processed` events
   * grouped by provider, priced at the config-driven per-image cost.
   */
  private async costIntelligence() {
    const perProvider = await this.analytics
      .createQueryBuilder("e")
      .select("e.properties ->> 'provider'", "provider")
      .addSelect("COUNT(*)", "calls")
      .where("e.name = :name", { name: "media.processed" })
      .groupBy("e.properties ->> 'provider'")
      .getRawMany<{ provider: string | null; calls: string }>();

    let estimatedSpend = 0;
    const byProvider = perProvider.map((row) => {
      const provider = row.provider ?? "unknown";
      const calls = Number(row.calls);
      const unit = costPerImage(provider);
      const spend = roundCurrency(calls * unit);
      estimatedSpend += spend;
      return { provider, apiCalls: calls, costPerImage: unit, estimatedSpend: spend };
    });

    const totalCalls = byProvider.reduce((sum, p) => sum + p.apiCalls, 0);
    const averageCostPerImage = totalCalls > 0 ? roundCurrency(estimatedSpend / totalCalls) : 0;

    return {
      apiCalls: totalCalls,
      estimatedSpendToDate: roundCurrency(estimatedSpend),
      averageCostPerImage,
      byProvider,
    };
  }

  /**
   * Provider health (WS10). Derived from real analytics events so operators can
   * immediately see whether the provider is unhealthy: last success/failure,
   * failure rate, timeout rate and rate-limit (429) rate.
   */
  private async providerHealth() {
    const [processed, failures, timeouts, providerErrors] = await Promise.all([
      this.analytics.count({ where: { name: "media.processed" } }),
      this.analytics.count({ where: { name: "media.failed" } }),
      this.analytics.count({ where: { name: "media.provider_timeout" } }),
      this.analytics.count({ where: { name: "media.provider_error" } }),
    ]);

    const rateLimitedRow = await this.analytics
      .createQueryBuilder("e")
      .where("e.name = :name", { name: "media.provider_error" })
      .andWhere("e.properties ->> 'rateLimited' = 'true'")
      .getCount();

    const lastSuccess = await this.analytics.findOne({ where: { name: "media.processed" }, order: { occurredAt: "DESC" } });
    const lastFailure = await this.analytics.findOne({ where: { name: "media.failed" }, order: { occurredAt: "DESC" } });

    const attempts = processed + failures;
    return {
      lastSuccessAt: lastSuccess?.occurredAt ?? null,
      lastFailureAt: lastFailure?.occurredAt ?? null,
      failures,
      timeouts,
      providerErrors,
      rateLimited: rateLimitedRow,
      failureRate: attempts > 0 ? Math.round((failures / attempts) * 100) : null,
      timeoutRate: attempts > 0 ? Math.round((timeouts / attempts) * 100) : null,
      rateLimitRate: attempts > 0 ? Math.round((rateLimitedRow / attempts) * 100) : null,
      status: attempts === 0 ? "unknown" : failures / attempts >= 0.25 ? "unhealthy" : failures / attempts >= 0.05 ? "degraded" : "healthy",
    };
  }

  async list(query: { status?: string; provider?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const qb = this.assets.createQueryBuilder("a").orderBy('a."createdAt"', "DESC");
    if (query.status) qb.andWhere('a."processingStatus" = :status', { status: query.status });
    if (query.provider) {
      qb.andWhere('EXISTS (SELECT 1 FROM "media_derivatives" d WHERE d."assetId" = a."id" AND d."provider" = :provider)', { provider: query.provider });
    }
    const range = this.parseRange(query.from, query.to);
    if (range) qb.andWhere({ createdAt: Between(range.from, range.to) });
    const total = await qb.getCount();
    const rows = await qb.offset((page - 1) * pageSize).limit(pageSize).getMany();
    return {
      total, page, pageSize,
      records: rows.map((a) => ({ id: a.id, ownerUserId: a.ownerUserId ?? null, originalUrl: a.originalUrl, processingStatus: a.processingStatus, retryCount: a.retryCount, lastError: a.lastError ?? null, createdAt: a.createdAt, updatedAt: a.updatedAt })),
    };
  }

  /** Inclusive day-boundary range parsing; ignores malformed input rather than throwing. */
  private parseRange(from?: string, to?: string): { from: Date; to: Date } | null {
    if (!from && !to) return null;
    const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(0);
    const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { from: start, to: end };
  }

  inspect(assetId: string) {
    return this.processing.detail(assetId);
  }

  retry(assetId: string) {
    return this.processing.retry(assetId);
  }

  /** Regenerate: re-run the pipeline. A same-provider-version derivative is
   *  reused (cache); a provider-version bump produces a fresh derivative. */
  regenerate(assetId: string) {
    return this.processing.regenerate(assetId);
  }
}
