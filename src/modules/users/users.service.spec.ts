import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository, QueryFailedError } from "typeorm";
import * as bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { UsersService } from "./users.service";
import { UploadsService } from "../uploads/uploads.service";
import { PrivacyService } from "../privacy/privacy.service";
import { MailService } from "../../common/services/mail.service";
import { User } from "../../entities";

/** Mirror the service's hash function for test setup */
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

describe("UsersService", () => {
  let service: UsersService;
  let repository: Repository<User>;

  const mockUser = {
    id: "user_1",
    fullName: "John Doe",
    email: "john@example.com",
    country: "US",
    passwordHash: "hashed_password123",
    hasUsablePassword: true,
    connectedPlatforms: [],
    isSuspended: false,
    suspensionReason: null,
    suspendedAt: null,
    lastLoginAt: null,
    signupSource: "email",
    sessionVersion: 0,
    createdAt: new Date(),
    resetCode: undefined,
    resetCodeExpiresAt: undefined,
    resetCodeAttempts: 0,
    repits: [],
    pushTokens: [],
    emailVerified: false,
    emailVerifyCode: undefined,
    emailVerifyCodeExpiresAt: undefined,
    pendingEmail: null,
    pendingEmailCodeHash: null,
    pendingEmailExpiresAt: null,
    pendingEmailAttempts: 0,
    pendingEmailRequestedAt: null,
  };

  const mockUploadsService = {
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrivacyService = {
    recordAccountDeletion: jest.fn().mockResolvedValue(undefined),
  };

  const mockMailService = {
    sendRaw: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: UploadsService,
          useValue: mockUploadsService,
        },
        {
          provide: PrivacyService,
          useValue: mockPrivacyService,
        },
        {
          provide: MailService,
          useValue: mockMailService,
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
    it("should return a reset token for valid code within window", async () => {
      const userWithCode = {
        ...mockUser,
        resetCode: hashCode("123456"),
        resetCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      };
      mockRepository.findOne.mockResolvedValue(userWithCode);
      mockRepository.save.mockResolvedValue(userWithCode);

      const result = await service.verifyResetCode("john@example.com", "123456");

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(repository.save).toHaveBeenCalled();
    });

    it("should return null for wrong code", async () => {
      const userWithCode = {
        ...mockUser,
        resetCode: hashCode("123456"),
        resetCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      };
      mockRepository.findOne.mockResolvedValue(userWithCode);
      mockRepository.save.mockResolvedValue(userWithCode);

      const result = await service.verifyResetCode("john@example.com", "999999");

      expect(result).toBeNull();
    });

    it("should return null for expired code", async () => {
      const userWithCode = {
        ...mockUser,
        resetCode: hashCode("123456"),
        resetCodeExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
      };
      mockRepository.findOne.mockResolvedValue(userWithCode);

      const result = await service.verifyResetCode("john@example.com", "123456");

      expect(result).toBeNull();
    });

    it("should return null when no code set", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.verifyResetCode("john@example.com", "123456");

      expect(result).toBeNull();
    });

    it("should return null when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.verifyResetCode("nonexistent@example.com", "123456");

      expect(result).toBeNull();
    });
  });

  describe("resetPassword", () => {
    it("should update hash, clear reset code, revoke sessions, and return true", async () => {
      const validToken = "abc123validtoken";
      const userBeforeReset = {
        ...mockUser,
        sessionVersion: 3,
        resetCode: hashCode("123456"),
        resetCodeExpiresAt: new Date(),
        // Stored hashed, exactly like the reset code.
        resetToken: hashCode(validToken),
        resetTokenExpiresAt: new Date(Date.now() + 600000),
      };
      mockRepository.findOne.mockResolvedValue(userBeforeReset);
      mockRepository.save.mockImplementation(async (u: unknown) => u);

      const result = await service.resetPassword("john@example.com", validToken, "newpassword");

      expect(bcrypt.hash).toHaveBeenCalledWith("newpassword", 10);
      expect(result).toBe(true);
      const saved = mockRepository.save.mock.calls[0][0];
      expect(saved.resetToken).toBeUndefined();
      // Session invalidation: sessionVersion must be incremented.
      expect(saved.sessionVersion).toBe(4);
    });

    it("should reject a token that does not match the stored hash", async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockUser,
        resetToken: hashCode("the-real-token"),
        resetTokenExpiresAt: new Date(Date.now() + 600000),
      });

      const result = await service.resetPassword("john@example.com", "a-different-token", "newpassword");
      expect(result).toBe(false);
    });

    it("should return false when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.resetPassword("nonexistent@example.com", "some-token", "newpassword");

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

    it("should update fullName individually", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const updatedUser = { ...mockUser, fullName: "Updated Name" };
      mockRepository.save.mockResolvedValue(updatedUser);

      const result = await service.updateProfile("user_1", { fullName: "Updated Name" });

      expect(result).toEqual(updatedUser);
    });

    it("IGNORES any email passed to updateProfile — email only changes via the verified workflow", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockImplementation(async (u: unknown) => u);

      const result = await service.updateProfile("user_1", {
        // @ts-expect-error — email is intentionally not part of the signature
        email: "newemail@example.com",
        fullName: "Renamed",
      });

      expect((result as User).email).toBe("john@example.com"); // unchanged
      expect((result as User).fullName).toBe("Renamed");
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
    it("should hash, save, revoke sessions, and return true", async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockUser, sessionVersion: 1 });
      mockRepository.save.mockImplementation(async (u: unknown) => u);

      const result = await service.changePassword("user_1", "newpassword");

      expect(bcrypt.hash).toHaveBeenCalledWith("newpassword", 10);
      expect(result).toBe(true);
      // Session invalidation on explicit password change.
      expect(mockRepository.save.mock.calls[0][0].sessionVersion).toBe(2);
    });

    it("should return false when user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.changePassword("nonexistent", "newpassword");

      expect(result).toBe(false);
    });
  });

  describe("email change workflow (Finding 2)", () => {
    const pgUnique = () =>
      Object.assign(new QueryFailedError("q", [], new Error("dup")), { code: "23505" });

    it("requestEmailChange stages the new email + code hash after a valid password proof", async () => {
      mockRepository.findOne
        .mockResolvedValueOnce({ ...mockUser }) // findById(user)
        .mockResolvedValueOnce(null); // findByEmail(newEmail) → free
      mockRepository.save.mockImplementation(async (u: unknown) => u);

      const result = await service.requestEmailChange("user_1", "New@Example.com", "password123");

      expect(result.staged).toBe(true);
      expect(result.code).toMatch(/^\d{6}$/);
      const saved = mockRepository.save.mock.calls.at(-1)![0];
      expect(saved.pendingEmail).toBe("new@example.com"); // normalized
      expect(saved.pendingEmailCodeHash).toBe(hashCode(result.code!));
      expect(saved.pendingEmailCodeHash).not.toBe(result.code); // never raw
      expect(mockMailService.sendRaw).toHaveBeenCalledWith(
        expect.objectContaining({ to: "new@example.com", sensitive: true }),
      );
    });

    it("requestEmailChange rejects a wrong current password (recent-auth proof)", async () => {
      mockRepository.findOne.mockResolvedValueOnce({ ...mockUser });
      await expect(
        service.requestEmailChange("user_1", "new@example.com", "wrong"),
      ).rejects.toThrow(/current password/i);
    });

    it("requestEmailChange is enumeration-safe: taken address stages nothing but does not error", async () => {
      mockRepository.findOne
        .mockResolvedValueOnce({ ...mockUser })
        .mockResolvedValueOnce({ ...mockUser, id: "user_2", email: "taken@example.com" });
      mockRepository.save.mockImplementation(async (u: unknown) => u);

      const result = await service.requestEmailChange("user_1", "taken@example.com", "password123");

      expect(result).toEqual({ staged: false, code: null });
      expect(mockMailService.sendRaw).not.toHaveBeenCalled();
    });

    it("requestEmailChange for a social-only account requires this session's recent authTime", async () => {
      const social = { ...mockUser, hasUsablePassword: false, lastLoginAt: new Date() };
      mockRepository.findOne.mockResolvedValueOnce(social);
      await expect(
        service.requestEmailChange("user_1", "new@example.com"),
      ).rejects.toThrow(/sign in again/i);

      mockRepository.findOne
        .mockResolvedValueOnce(social)
        .mockResolvedValueOnce(null);
      mockRepository.save.mockImplementation(async (u: unknown) => u);
      const ok = await service.requestEmailChange(
        "user_1",
        "new@example.com",
        undefined,
        Math.floor(Date.now() / 1000),
      );
      expect(ok.staged).toBe(true);
    });

    it("confirmEmailChange swaps email, marks verified, clears pending, bumps sessionVersion", async () => {
      const code = "123456";
      const pending = {
        ...mockUser,
        emailVerified: false,
        sessionVersion: 3,
        pendingEmail: "new@example.com",
        pendingEmailCodeHash: hashCode(code),
        pendingEmailExpiresAt: new Date(Date.now() + 60_000),
        pendingEmailAttempts: 0,
      };
      mockRepository.findOne.mockResolvedValueOnce(pending);
      mockRepository.save.mockImplementation(async (u: unknown) => u);

      const result = await service.confirmEmailChange("user_1", code);

      expect(result.email).toBe("new@example.com");
      expect(result.emailVerified).toBe(true);
      expect(result.sessionVersion).toBe(4);
      expect(result.pendingEmail).toBeNull();
      expect(result.pendingEmailCodeHash).toBeNull();
    });

    it("confirmEmailChange rejects a wrong code and counts the attempt", async () => {
      const pending = {
        ...mockUser,
        pendingEmail: "new@example.com",
        pendingEmailCodeHash: hashCode("123456"),
        pendingEmailExpiresAt: new Date(Date.now() + 60_000),
        pendingEmailAttempts: 0,
      };
      mockRepository.findOne.mockResolvedValueOnce(pending);
      mockRepository.save.mockImplementation(async (u: unknown) => u);

      await expect(service.confirmEmailChange("user_1", "000000")).rejects.toThrow(/incorrect/i);
      expect(mockRepository.save.mock.calls.at(-1)![0].pendingEmailAttempts).toBe(1);
    });

    it("confirmEmailChange rejects an expired code and clears the pending change (no replay)", async () => {
      const pending = {
        ...mockUser,
        pendingEmail: "new@example.com",
        pendingEmailCodeHash: hashCode("123456"),
        pendingEmailExpiresAt: new Date(Date.now() - 1000),
      };
      mockRepository.findOne.mockResolvedValueOnce(pending);
      mockRepository.save.mockImplementation(async (u: unknown) => u);

      await expect(service.confirmEmailChange("user_1", "123456")).rejects.toThrow(/expired/i);
      expect(mockRepository.save.mock.calls.at(-1)![0].pendingEmail).toBeNull();
    });

    it("confirmEmailChange voids after too many attempts", async () => {
      const pending = {
        ...mockUser,
        pendingEmail: "new@example.com",
        pendingEmailCodeHash: hashCode("123456"),
        pendingEmailExpiresAt: new Date(Date.now() + 60_000),
        pendingEmailAttempts: 5,
      };
      mockRepository.findOne.mockResolvedValueOnce(pending);
      mockRepository.save.mockImplementation(async (u: unknown) => u);

      await expect(service.confirmEmailChange("user_1", "123456")).rejects.toThrow(/too many/i);
      expect(mockRepository.save.mock.calls.at(-1)![0].pendingEmail).toBeNull();
    });

    it("confirmEmailChange surfaces a uniqueness collision (concurrent claim) — never false success", async () => {
      const code = "123456";
      const pending = {
        ...mockUser,
        pendingEmail: "new@example.com",
        pendingEmailCodeHash: hashCode(code),
        pendingEmailExpiresAt: new Date(Date.now() + 60_000),
        pendingEmailAttempts: 0,
      };
      mockRepository.findOne
        .mockResolvedValueOnce(pending) // initial load
        .mockResolvedValueOnce({ ...pending }); // reload to clear after clash
      mockRepository.save
        .mockRejectedValueOnce(pgUnique()) // the swap loses to a concurrent claim
        .mockImplementation(async (u: unknown) => u);

      await expect(service.confirmEmailChange("user_1", code)).rejects.toThrow(ConflictException);
    });

    it("confirmEmailChange with no pending change is a clean bad request", async () => {
      mockRepository.findOne.mockResolvedValueOnce({ ...mockUser, pendingEmail: null });
      await expect(service.confirmEmailChange("user_1", "123456")).rejects.toThrow(/no pending/i);
    });
  });

});
