import { AdminAnalyticsService } from "./admin-analytics.service";

/**
 * DB-free: mock DataSource.query, dispatching by a marker in the SQL so we can
 * assert the response *shaping* (ratios, honest nulls, latency) without Postgres.
 */
function makeService(dispatch: (sql: string) => unknown[]) {
  const dataSource = { query: jest.fn(async (sql: string) => dispatch(sql)) };
  return { service: new AdminAnalyticsService(dataSource as never), dataSource };
}

describe("AdminAnalyticsService", () => {
  it("shapes funnel stages and conversion rates from event counts", async () => {
    const { service } = makeService((sql) => {
      if (sql.includes("user.registered") && sql.includes("repitsPublished")) {
        return [{ registered: "100", logins: "220", creators: "40", repitsCreated: "60", publishers: "25", repitsPublished: "30" }];
      }
      if (sql.includes("templates t")) return [];
      if (sql.includes("cohorts")) return [];
      if (sql.includes("music.%")) return [{ spotify: "0", apple: "0", imports: "0", disconnects: "0" }];
      if (sql.includes("media.%")) return [{ started: "0", completed: "0", failed: "0", timeouts: "0", errors: "0", cacheHits: "0" }];
      if (sql.includes("percentile_cont")) return [{ p50: null, p95: null, avg: null, samples: "0" }];
      return [];
    });

    const out = (await service.getOverview({ range: "30d" } as never)) as any;
    expect(out.funnel.stages).toEqual([
      { key: "registered", label: "Registered", value: 100 },
      { key: "creators", label: "Created a repit", value: 40 },
      { key: "publishers", label: "Published a repit", value: 25 },
    ]);
    expect(out.funnel.rates.registeredToCreator).toBeCloseTo(0.4);
    expect(out.funnel.rates.creatorToPublisher).toBeCloseTo(0.625);
    expect(out.funnel.rates.createToPublish).toBeCloseTo(0.5);
  });

  it("returns null ratios (not NaN) when denominators are zero", async () => {
    const { service } = makeService((sql) => {
      if (sql.includes("user.registered") && sql.includes("repitsPublished")) {
        return [{ registered: "0", logins: "0", creators: "0", repitsCreated: "0", publishers: "0", repitsPublished: "0" }];
      }
      if (sql.includes("percentile_cont")) return [{ p50: null, p95: null, avg: null, samples: "0" }];
      if (sql.includes("music.%")) return [{}];
      if (sql.includes("media.%")) return [{}];
      return [];
    });
    const out = (await service.getOverview({ range: "7d" } as never)) as any;
    expect(out.funnel.rates.registeredToCreator).toBeNull();
    expect(out.providers.backgroundRemoval.successRate).toBeNull();
    expect(out.providers.backgroundRemoval.latencySeconds.p95).toBeNull();
  });

  it("computes template conversion and background-removal success rate", async () => {
    const { service } = makeService((sql) => {
      if (sql.includes("user.registered") && sql.includes("repitsPublished")) {
        return [{ registered: "1", logins: "1", creators: "1", repitsCreated: "1", publishers: "1", repitsPublished: "1" }];
      }
      if (sql.includes("templates t")) {
        return [{ templateId: "t1", name: "Ice Girl", created: "10", published: "4" }];
      }
      if (sql.includes("cohorts")) return [];
      if (sql.includes("music.%")) return [{ spotify: "7", apple: "3", imports: "12", disconnects: "1" }];
      if (sql.includes("media.%")) return [{ started: "20", completed: "18", failed: "1", timeouts: "1", errors: "0", cacheHits: "5" }];
      if (sql.includes("percentile_cont")) return [{ p50: "2.5", p95: "9.1", avg: "3.2", samples: "18" }];
      return [];
    });
    const out = (await service.getOverview({ range: "30d" } as never)) as any;
    expect(out.templates[0]).toEqual({ templateId: "t1", name: "Ice Girl", created: 10, published: 4, conversion: 0.4 });
    expect(out.providers.music.spotifyConnected).toBe(7);
    expect(out.providers.backgroundRemoval.successRate).toBeCloseTo(18 / 20);
    expect(out.providers.backgroundRemoval.latencySeconds.p95).toBeCloseTo(9.1);
  });

  it("caches within the TTL — a second call does not re-query", async () => {
    const { service, dataSource } = makeService(() => [{}]);
    await service.getOverview({ range: "30d" } as never);
    const callsAfterFirst = dataSource.query.mock.calls.length;
    await service.getOverview({ range: "30d" } as never);
    expect(dataSource.query.mock.calls.length).toBe(callsAfterFirst);
  });

  it("rejects a custom range missing from/to", async () => {
    const { service } = makeService(() => [{}]);
    await expect(service.getOverview({ range: "custom" } as never)).rejects.toThrow(/require both/);
  });
});
