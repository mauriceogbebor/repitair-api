import { Test, TestingModule } from "@nestjs/testing";
import { getDataSourceToken } from "@nestjs/typeorm";
import { REDIS_CLIENT } from "../../common/modules/redis.module";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;
  const mockDataSource = {
    query: jest.fn(),
  };
  const mockRedis = {
    status: "ready",
    ping: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => jest.clearAllMocks());

  describe("getHealth", () => {
    it("should return ok when database is healthy", async () => {
      mockDataSource.query.mockResolvedValue([{ "?column?": 1 }]);
      const result = await controller.getHealth();
      expect(result.status).toBe("ok");
      expect(result.database).toBe("ok");
      expect(result.service).toBe("repitair-backend");
    });

    it("should return degraded when database is down", async () => {
      mockDataSource.query.mockRejectedValue(new Error("connection refused"));
      const result = await controller.getHealth();
      expect(result.status).toBe("degraded");
      expect(result.database).toBe("degraded");
    });
  });

  describe("getLive", () => {
    it("should return ok", () => {
      const result = controller.getLive();
      expect(result).toEqual({ status: "ok" });
    });
  });

  describe("getReady", () => {
    it("returns ok when dependencies are ready", async () => {
      mockDataSource.query.mockResolvedValue([{ "?column?": 1 }]);
      mockRedis.ping.mockResolvedValue("PONG");
      await expect(controller.getReady()).resolves.toEqual({
        status: "ok",
        database: "ok",
        redis: "ok",
      });
    });

    it("returns 503 when the database is unavailable", async () => {
      mockDataSource.query.mockRejectedValue(new Error("connection refused"));
      await expect(controller.getReady()).rejects.toMatchObject({ status: 503 });
    });

    it("returns 503 when Redis is unavailable", async () => {
      mockDataSource.query.mockResolvedValue([{ "?column?": 1 }]);
      mockRedis.status = "reconnecting";

      await expect(controller.getReady()).rejects.toMatchObject({ status: 503 });
      mockRedis.status = "ready";
    });
  });
});
