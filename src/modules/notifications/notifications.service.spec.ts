import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { NotificationsService } from "./notifications.service";
import { PushToken } from "../../entities";

describe("NotificationsService", () => {
  let service: NotificationsService;
  let repository: Repository<PushToken>;

  const mockPushToken = {
    id: "token_1",
    userId: "user_1",
    pushToken: "abc123def456",
    platform: "ios" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: undefined,
  };

  const mockRepository = {
    delete: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(PushToken),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    repository = module.get<Repository<PushToken>>(getRepositoryToken(PushToken));
  });

  describe("registerToken", () => {
    it("should save a new token when no existing token", async () => {
      mockRepository.delete.mockResolvedValue({ affected: 0 });
      mockRepository.create.mockReturnValue(mockPushToken);
      mockRepository.save.mockResolvedValue(mockPushToken);

      const result = await service.registerToken("user_1", "abc123def456", "ios");

      expect(repository.delete).toHaveBeenCalledWith({
        userId: "user_1",
        platform: "ios",
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_1",
          pushToken: "abc123def456",
          platform: "ios",
        })
      );
      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual(mockPushToken);
    });

    it("should remove existing token before saving when token exists for same user+platform", async () => {
      const oldToken = { ...mockPushToken, id: "old_token" };
      mockRepository.delete.mockResolvedValue({ affected: 1 });
      mockRepository.create.mockReturnValue(mockPushToken);
      mockRepository.save.mockResolvedValue(mockPushToken);

      const result = await service.registerToken("user_1", "abc123def456", "ios");

      expect(repository.delete).toHaveBeenCalledWith({
        userId: "user_1",
        platform: "ios",
      });
      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual(mockPushToken);
    });

    it("should handle android platform", async () => {
      const androidToken = { ...mockPushToken, platform: "android" as const };
      mockRepository.delete.mockResolvedValue({ affected: 0 });
      mockRepository.create.mockReturnValue(androidToken);
      mockRepository.save.mockResolvedValue(androidToken);

      const result = await service.registerToken("user_1", "xyz789", "android");

      expect(repository.delete).toHaveBeenCalledWith({
        userId: "user_1",
        platform: "android",
      });
      expect(result.platform).toBe("android");
    });
  });

  describe("removeToken", () => {
    it("should return true when affected > 0", async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      const result = await service.removeToken("user_1", "ios");

      expect(repository.delete).toHaveBeenCalledWith({
        userId: "user_1",
        platform: "ios",
      });
      expect(result).toBe(true);
    });

    it("should return false when affected === 0", async () => {
      mockRepository.delete.mockResolvedValue({ affected: 0 });

      const result = await service.removeToken("user_1", "ios");

      expect(result).toBe(false);
    });

    it("should return false when affected is undefined", async () => {
      mockRepository.delete.mockResolvedValue({});

      const result = await service.removeToken("user_1", "ios");

      expect(result).toBe(false);
    });

    it("should handle android platform", async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      const result = await service.removeToken("user_1", "android");

      expect(repository.delete).toHaveBeenCalledWith({
        userId: "user_1",
        platform: "android",
      });
      expect(result).toBe(true);
    });
  });

  describe("getTokensForUser", () => {
    it("should call repo.find with userId", async () => {
      mockRepository.find.mockResolvedValue([mockPushToken]);

      const result = await service.getTokensForUser("user_1");

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: "user_1" },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockPushToken);
    });

    it("should return empty array when user has no tokens", async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.getTokensForUser("user_2");

      expect(result).toEqual([]);
    });

    it("should return multiple tokens for user", async () => {
      const token2 = { ...mockPushToken, id: "token_2", platform: "android" as const };
      mockRepository.find.mockResolvedValue([mockPushToken, token2]);

      const result = await service.getTokensForUser("user_1");

      expect(result).toHaveLength(2);
    });
  });
});
