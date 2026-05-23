import { Test, TestingModule } from "@nestjs/testing";
import { getDataSourceToken } from "@nestjs/typeorm";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;
  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getDataSourceToken(), useValue: mockDataSource },
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
});
