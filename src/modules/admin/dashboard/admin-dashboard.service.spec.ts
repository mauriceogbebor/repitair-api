import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AdminDashboardService } from "./admin-dashboard.service";

describe("AdminDashboardService", () => {
  const snapshot = {
    totalUsers: "120",
    activeUsers24h: "18",
    previousActiveUsers24h: "12",
    newUsersToday: "5",
    newUsersYesterday: "4",
    newUsersCurrent: "30",
    newUsersPrevious: "20",
    totalRepits: "220",
    repitsToday: "8",
    repitsYesterday: "6",
    draftRepits: "40",
    publishedRepits: "160",
    reportedRepits: "3",
    publishedTemplates: "12",
    activeSpotlights: "2",
    openSupportTickets: "7",
    moderationQueue: "4",
    repitsCurrent: "50",
    repitsPrevious: "25",
  };

  function createService() {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('AS "totalUsers"')) return [snapshot];
      if (sql === "SELECT 1") return [{ result: 1 }];
      if (sql.includes('FROM users WHERE "lastLoginAt"')) return [{ value: "22" }];
      if (sql.includes("FROM users GROUP BY 1")) return [{ name: "Active", value: "100" }, { name: "Pending verification", value: "20" }];
      if (sql.includes("FROM users WHERE") && sql.includes("date_trunc")) return [{ bucket: new Date("2026-07-01T00:00:00Z"), value: "4" }];
      if (sql.includes("FROM repits WHERE") && sql.includes("date_trunc")) return [{ bucket: new Date("2026-07-01T00:00:00Z"), value: "6" }];
      if (sql.includes("LEFT JOIN templates")) return [{ name: "Echo Room", value: "6" }];
      if (sql.includes("FROM spotlights GROUP")) return [{ name: "active", value: "2", impressions: "100", clicks: "10" }];
      if (sql.includes("FROM contact_submissions WHERE") && sql.includes("date_trunc")) return [{ bucket: new Date("2026-07-01T00:00:00Z"), new: "2", closed: "1", escalated: "0", pending: "1" }];
      if (sql.includes('AS "averageResolutionHours"')) return [{ name: "open", value: "2", averageResolutionHours: "4.5" }];
      if (sql.includes("moderation GROUP BY name")) return [{ name: "Pending", value: "3" }];
      if (sql.includes("FROM repit_moderation_reports") && sql.includes("date_trunc")) return [{ bucket: new Date("2026-07-01T00:00:00Z"), value: "3" }];
      if (sql.includes("LOWER(platform)")) return [{ name: "Spotify", value: "5" }];
      if (sql.includes("FROM admin_audit_logs")) return [{ bucket: new Date("2026-07-01T00:00:00Z"), successful: "4", failed: "1" }];
      if (sql.includes("FROM repits WHERE") && sql.includes("CASE")) return [{ name: "Published", value: "6" }];
      return [];
    });
    const dataSource = { query } as unknown as DataSource;
    const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;
    return { service: new AdminDashboardService(dataSource, config, null), query };
  }

  it("returns chart-ready real-data sections and explicit unavailable datasets", async () => {
    const { service } = createService();
    const result = (await service.getOverview({ range: "30d" })) as {
      kpis: Array<{ id: string; value: number | null; changePercent: number | null }>;
      users: { growth: Array<{ date: string; value: number }> };
      spotlight: { summary: { impressions: number; clicks: number; clickThroughRate: number } };
      repits: { exports: { available: boolean } };
      storage: { available: boolean };
      health: Array<{ id: string; status: string }>;
    };

    expect(result.kpis).toHaveLength(14);
    expect(result.kpis.find((item) => item.id === "total-users")).toMatchObject({ value: 120, changePercent: 50 });
    expect(result.users.growth).toEqual([{ date: "2026-07-01T00:00:00.000Z", value: 4 }]);
    expect(result.spotlight.summary).toEqual({ impressions: 100, clicks: 10, clickThroughRate: 10 });
    expect(result.repits.exports).toMatchObject({ available: false });
    expect(result.storage).toMatchObject({ available: false });
    expect(result.health.find((item) => item.id === "postgresql")).toMatchObject({ status: "healthy" });
  });

  it("caches identical range requests for the documented short TTL", async () => {
    const { service, query } = createService();
    await service.getOverview({ range: "7d" });
    const callsAfterFirstRequest = query.mock.calls.length;
    await service.getOverview({ range: "7d" });
    expect(query).toHaveBeenCalledTimes(callsAfterFirstRequest);
  });

  it("rejects incomplete and oversized custom ranges", async () => {
    const { service } = createService();
    await expect(service.getOverview({ range: "custom" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getOverview({ range: "custom", from: "2024-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" })).rejects.toBeInstanceOf(BadRequestException);
  });
});
