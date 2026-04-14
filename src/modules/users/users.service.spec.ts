import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository, QueryFailedError } from "typeorm";
import * as bcrypt from "bcryptjs";
import { UsersService } from "./users.service";
import { User } from "../../entities";

describe("UsersService", () => {
  let service: UsersService;
  let repository: Repository<User>;

  const mockUser = {
    id: "user_1",
    fullName: "John Doe",
    email: "john@example.com",
    country: "US",
    passwordHash: "hashed_password123",
    connectedPlatforms: [],
    createdAt: new Date(),
    resetCode: undefined,
    resetCodeExpiresAt: undefined,
    repits: [],
    pushTokens: [],
  };

  const mockRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock bcrypt functions
    jest.spyOn(bcrypt, "hash").mockImplementation((password, saltOrRounds) => {
      return Promise.resolve(`hashed_${password}`) as Promise<string>;
    });

    jest
      .spyOn(bcrypt, "compare")
      .mockImplementation((password, hash) => {
        return Promise.resolve(hash === `hashed_${password}`) as Promise<boolean>;
      });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("findByEmail", () => {
    it("should call repo.findOne with ILike", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findByEmail("john@example.com");

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: expect.anything() },
      });
      expect(result).toEqual(mockUser);
    });

    it("should return null when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findByEmail("nonexistent@example.com");

      expect(result).toBeNull();
    });
  });

  describe("findById", () => {
    it("should call repo.findOne by id", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findById("user_1");

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: "user_1" },
      });
      expect(result).toEqual(mockUser);
    });

    it("should return null when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("createUser", () => {
    const createData = {
      fullName: "Jane Doe",
      email: "jane@example.com",
      country: "CA",
      password: "password123",
    };

    it("should hash password, save, and return the user", async () => {
      mockRepository.findOne.mockResolvedValue(null);
      const newUser = { ...mockUser, ...createData, email: createData.email.toLowerCase() };
      mockRepository.create.mockReturnValue(newUser);
      mockRepository.save.mockResolvedValue(newUser);

      const result = await service.createUser(createData);

      expect(bcrypt.hash).toHaveBeenCalledWith(createData.password, 10);
      expect(repository.create).toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual(newUser);
    });

    it("should throw ConflictException when findByEmail returns existing", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.createUser(createData)).rejects.toThrow(ConflictException);
    });

    it("should catch Postgres unique-violation and rethrow as ConflictException", async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue(mockUser);

      const error = new QueryFailedError("query", [], new Error("duplicate"));
      (error as any).code = "23505";
      mockRepository.save.mockRejectedValue(error);

      await expect(service.createUser(createData)).rejects.toThrow(ConflictException);
    });
  });

  describe("validatePassword", () => {
    it("should return true for correct password", async () => {
      const result = await service.validatePassword(mockUser, "password123");

      expect(bcrypt.compare).toHaveBeenCalledWith("password123", mockUser.passwordHash);
      expect(result).toBe(true);
    });

    it("should return false for wrong password", async () => {
      const result = await service.validatePassword(mockUser, "wrongpassword");

      expect(result).toBe(false);
    });
  });

  describe("setResetCode", () => {
    it("should generate a 6-digit code and save with expiry", async () => {
      const userWithCode = { ...mockUser };
      mockRepository.findOne.mockResolvedValue(userWithCode);
      mockRepository.save.mockResolvedValue(userWithCode);

      const result = await service.setResetCode("john@example.com");

      expect(result).toMatch(/^\d{6}$/);
      expect(repository.save).toHaveBeenCalled();
    });

    it("should return null when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.setResetCode("nonexistent@example.com");

      expect(result).toBeNull();
    });
  });

  describe("verifyResetCode", () => {
    it("should return true for valid code within window", async () => {
      const userWithCode = {
        ...mockUser,
        resetCode: "123456",
        resetCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      };
      mockRepository.findOne.mockResolvedValue(userWithCode);

      const result = await service.verifyResetCode("john@example.com", "123456");

      expect(result).toBe(true);
    });

    it("should return false for wrong code", async () => {
      const userWithCode = {
        ...mockUser,
        resetCode: "123456",
        resetCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      };
      mockRepository.findOne.mockResolvedValue(userWithCode);

      const result = await service.verifyResetCode("john@example.com", "999999");

      expect(result).toBe(false);
    });

    it("should return false for expired code", async () => {
      const userWithCode = {
        ...mockUser,
        resetCode: "123456",
        resetCodeExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
      };
      mockRepository.findOne.mockResolvedValue(userWithCode);

      const result = await service.verifyResetCode("john@example.com", "123456");

      expect(result).toBe(false);
    });

    it("should return false when no code set", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.verifyResetCode("john@example.com", "123456");

      expect(result).toBe(false);
    });

    it("should return false when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.verifyResetCode("nonexistent@example.com", "123456");

      expect(result).toBe(false);
    });
  });

  describe("resetPassword", () => {
    it("should update hash, clear reset code, and return true", async () => {
      const userBeforeReset = {
        ...mockUser,
        resetCode: "123456",
        resetCodeExpiresAt: new Date(),
      };
      mockRepository.findOne.mockResolvedValue(userBeforeReset);
      mockRepository.save.mockResolvedValue({
        ...userBeforeReset,
        passwordHash: "hashed_newpassword",
        resetCode: undefined,
        resetCodeExpiresAt: undefined,
      });

      const result = await service.resetPassword("john@example.com", "newpassword");

      expect(bcrypt.hash).toHaveBeenCalledWith("newpassword", 10);
      expect(repository.save).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.resetPassword("nonexistent@example.com", "newpassword");

      expect(result).toBe(false);
    });
  });

  describe("updateProfile", () => {
    it("should not call findByEmail a second time when email unchanged", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockResolvedValue(mockUser);

      const findByEmailSpy = jest.spyOn(service, "findByEmail");

      await service.updateProfile("user_1", { fullName: "New Name" });

      expect(findByEmailSpy).not.toHaveBeenCalled();
    });

    it("should throw ConflictException when email changes to another user's email", async () => {
      const otherUser = { ...mockUser, id: "user_2", email: "other@example.com" };
      mockRepository.findOne.mockResolvedValueOnce(mockUser);
      mockRepository.findOne.mockResolvedValueOnce(otherUser);

      await expect(
        service.updateProfile("user_1", { email: "other@example.com" })
      ).rejects.toThrow(ConflictException);
    });

    it("should update fullName individually", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const updatedUser = { ...mockUser, fullName: "Updated Name" };
      mockRepository.save.mockResolvedValue(updatedUser);

      const result = await service.updateProfile("user_1", { fullName: "Updated Name" });

      expect(result).toEqual(updatedUser);
    });

    it("should update email individually", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const updatedUser = { ...mockUser, email: "newemail@example.com" };
      mockRepository.save.mockResolvedValue(updatedUser);

      const result = await service.updateProfile("user_1", { email: "newemail@example.com" });

      expect(result).toEqual(updatedUser);
    });

    it("should update country individually", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const updatedUser = { ...mockUser, country: "UK" };
      mockRepository.save.mockResolvedValue(updatedUser);

      const result = await service.updateProfile("user_1", { country: "UK" });

      expect(result).toEqual(updatedUser);
    });
  });

  describe("changePassword", () => {
    it("should hash and save, and return true", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const updatedUser = { ...mockUser, passwordHash: "hashed_newpassword" };
      mockRepository.save.mockResolvedValue(updatedUser);

      const result = await service.changePassword("user_1", "newpassword");

      expect(bcrypt.hash).toHaveBeenCalledWith("newpassword", 10);
      expect(repository.save).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.changePassword("nonexistent", "newpassword");

      expect(result).toBe(false);
    });
  });

  describe("connectPlatform", () => {
    it("should add platform to array when not present", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const updatedUser = { ...mockUser, connectedPlatforms: ["spotify"] };
      mockRepository.save.mockResolvedValue(updatedUser);

      const result = await service.connectPlatform("user_1", "spotify");

      expect(repository.save).toHaveBeenCalled();
      expect(result?.connectedPlatforms).toContain("spotify");
    });

    it("should be a no-op when platform already in array", async () => {
      const userWithPlatform = { ...mockUser, connectedPlatforms: ["spotify"] };
      mockRepository.findOne.mockResolvedValue(userWithPlatform);

      await service.connectPlatform("user_1", "spotify");

      expect(repository.save).not.toHaveBeenCalled();
    });

    it("should return null when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.connectPlatform("nonexistent", "spotify");

      expect(result).toBeNull();
    });
  });
});
