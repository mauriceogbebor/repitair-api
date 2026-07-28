import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, ILike, QueryFailedError } from "typeorm";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { User } from "../../entities";
import { UploadsService } from "../uploads/uploads.service";
import { PrivacyService } from "../privacy/privacy.service";

export type { User as UserRecord };

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION;
}

const LEGACY_MISSING_USER_COLUMNS = [
  "avatarUrl",
  "resetToken",
  "resetTokenExpiresAt",
  "resetCodeAttempts",
  "emailVerified",
  "emailVerifyCode",
  "emailVerifyCodeExpiresAt",
  "isSuspended",
  "suspensionReason",
  "suspendedAt",
  "lastLoginAt",
  "signupSource",
  "sessionVersion",
];

function isLegacyUserSchemaError(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) {
    return false;
  }

  const message = String((err as QueryFailedError & { message?: string }).message ?? "");
  return LEGACY_MISSING_USER_COLUMNS.some((column) => message.includes(column));
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly uploadsService: UploadsService,
    private readonly privacyService: PrivacyService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.usersRepo.findOne({
        where: { email: ILike(email) },
      });
    } catch (err) {
      if (isLegacyUserSchemaError(err)) {
        return this.findByEmailLegacy(email);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<User | null> {
    try {
      return await this.usersRepo.findOne({
        where: { id },
      });
    } catch (err) {
      if (isLegacyUserSchemaError(err)) {
        return this.findByIdLegacy(id);
      }
      throw err;
    }
  }

  private findByEmailLegacy(email: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder("user")
      .select([
        "user.id",
        "user.fullName",
        "user.email",
        "user.country",
        "user.passwordHash",
        "user.connectedPlatforms",
        "user.createdAt",
        "user.resetCode",
        "user.resetCodeExpiresAt",
      ])
      .where("LOWER(user.email) = LOWER(:email)", { email })
      .getOne();
  }

  private findByIdLegacy(id: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder("user")
      .select([
        "user.id",
        "user.fullName",
        "user.email",
        "user.country",
        "user.passwordHash",
        "user.connectedPlatforms",
        "user.createdAt",
        "user.resetCode",
        "user.resetCodeExpiresAt",
      ])
      .where("user.id = :id", { id })
      .getOne();
  }

  async createUser(data: {
    fullName: string;
    email: string;
    country: string;
    password: string;
    signupSource?: string | null;
  }): Promise<User> {
    const existing = await this.findByEmail(data.email);
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = this.usersRepo.create({
      fullName: data.fullName,
      email: data.email.toLowerCase(),
      country: data.country,
      passwordHash,
      connectedPlatforms: [],
      signupSource: data.signupSource ?? "email",
    });

    try {
      return await this.usersRepo.save(user);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("An account with this email already exists");
      }
      throw err;
    }
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async recordLogin(userId: string): Promise<void> {
    await this.usersRepo.update({ id: userId }, { lastLoginAt: new Date() });
  }

  private hashCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
  }

  async setResetCode(email: string): Promise<string | null> {
    const user = await this.findByEmail(email);
    if (!user) return null;

    const code = String(randomInt(100000, 1000000));
    user.resetCode = this.hashCode(code);
    user.resetCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    user.resetCodeAttempts = 0;

    await this.usersRepo.save(user);

    return code;
  }

  async verifyResetCode(email: string, code: string): Promise<string | null> {
    const user = await this.findByEmail(email);
    if (!user || !user.resetCode || !user.resetCodeExpiresAt) return null;

    if (new Date(user.resetCodeExpiresAt) < new Date()) return null;

    if (user.resetCodeAttempts >= 5) {
      user.resetCode = undefined;
      user.resetCodeExpiresAt = undefined;
      user.resetCodeAttempts = 0;
      await this.usersRepo.save(user);
      return null;
    }

    const inputHash = this.hashCode(code);
    const storedBuf = Buffer.from(user.resetCode, "utf8");
    const inputBuf = Buffer.from(inputHash, "utf8");
    const codeMatch = storedBuf.length === inputBuf.length && timingSafeEqual(storedBuf, inputBuf);
    if (!codeMatch) {
      user.resetCodeAttempts += 1;
      await this.usersRepo.save(user);
      return null;
    }

    const resetToken = randomBytes(32).toString("hex");
    user.resetToken = resetToken;
    user.resetTokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    user.resetCode = undefined;
    user.resetCodeExpiresAt = undefined;

    await this.usersRepo.save(user);

    return resetToken;
  }

  async resetPassword(email: string, resetToken: string, newPassword: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user || !user.resetToken || !user.resetTokenExpiresAt) return false;

    if (new Date(user.resetTokenExpiresAt) < new Date()) return false;

    const expected = Buffer.from(user.resetToken, "utf8");
    const received = Buffer.from(resetToken, "utf8");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return false;
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetCode = undefined;
    user.resetCodeExpiresAt = undefined;
    user.resetToken = undefined;
    user.resetTokenExpiresAt = undefined;

    await this.usersRepo.save(user);

    return true;
  }

  async updateProfile(
    userId: string,
    data: { fullName?: string; email?: string; country?: string; avatarUrl?: string },
  ): Promise<User | null> {
    const user = await this.findById(userId);
    if (!user) return null;

    if (data.email && data.email.toLowerCase() !== user.email) {
      const existing = await this.findByEmail(data.email);
      if (existing && existing.id !== userId) {
        throw new ConflictException("An account with this email already exists");
      }
    }

    if (data.fullName !== undefined) user.fullName = data.fullName;
    if (data.email !== undefined) user.email = data.email.toLowerCase();
    if (data.country !== undefined) user.country = data.country;
    if (data.avatarUrl !== undefined) {
      user.avatarUrl = data.avatarUrl.trim() || undefined;
    }

    try {
      return await this.usersRepo.save(user);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("An account with this email already exists");
      }
      throw err;
    }
  }

  async changePassword(userId: string, newPassword: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user) return false;

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersRepo.save(user);

    return true;
  }

  async connectSpotify(userId: string, refreshToken: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    user.spotifyRefreshToken = refreshToken;
    if (!user.connectedPlatforms.includes("spotify")) {
      user.connectedPlatforms = [...user.connectedPlatforms, "spotify"];
    }

    await this.usersRepo.save(user);
  }

  async getSpotifyRefreshToken(userId: string): Promise<string | null> {
    const user = await this.usersRepo
      .createQueryBuilder("user")
      .addSelect("user.spotifyRefreshToken")
      .where("user.id = :id", { id: userId })
      .getOne();
    return user?.spotifyRefreshToken ?? null;
  }

  async getAppleMusicUserToken(userId: string): Promise<string | null> {
    const user = await this.usersRepo
      .createQueryBuilder("user")
      .addSelect("user.appleMusicUserToken")
      .where("user.id = :id", { id: userId })
      .getOne();
    return user?.appleMusicUserToken ?? null;
  }

  async connectAppleMusic(userId: string, userToken: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    user.appleMusicUserToken = userToken;
    if (!user.connectedPlatforms.includes("apple-music")) {
      user.connectedPlatforms = [...user.connectedPlatforms, "apple-music"];
    }

    await this.usersRepo.save(user);
  }

  async setEmailVerifyCode(userId: string): Promise<string | null> {
    const user = await this.findById(userId);
    if (!user) return null;

    const code = String(randomInt(100000, 1000000));
    user.emailVerifyCode = this.hashCode(code);
    user.emailVerifyCodeExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.usersRepo.save(user);
    return code;
  }

  async verifyEmail(userId: string, code: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user || !user.emailVerifyCode || !user.emailVerifyCodeExpiresAt) return false;

    if (new Date(user.emailVerifyCodeExpiresAt) < new Date()) return false;

    const inputHash = this.hashCode(code);
    const storedBuf = Buffer.from(user.emailVerifyCode, "utf8");
    const inputBuf = Buffer.from(inputHash, "utf8");
    const codeMatch = storedBuf.length === inputBuf.length && timingSafeEqual(storedBuf, inputBuf);
    if (!codeMatch) return false;

    user.emailVerified = true;
    user.emailVerifyCode = undefined;
    user.emailVerifyCodeExpiresAt = undefined;
    await this.usersRepo.save(user);
    return true;
  }

  async disconnectPlatform(userId: string, platform: string): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (platform === "spotify") {
      user.spotifyRefreshToken = undefined;
    } else if (platform === "apple-music") {
      user.appleMusicUserToken = undefined;
    }

    user.connectedPlatforms = user.connectedPlatforms.filter((p) => p !== platform);
    return this.usersRepo.save(user);
  }

  async deleteUser(userId: string): Promise<boolean> {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ["repits"],
    });
    if (!user) return false;

    if (user.avatarUrl) {
      this.tryDeleteUpload(user.avatarUrl);
    }
    for (const repit of user.repits ?? []) {
      if (repit.backgroundPhotoUrl) {
        this.tryDeleteUpload(repit.backgroundPhotoUrl);
      }
      this.tryDeleteCompositionAssets(repit.composition);
    }

    // Record the deletion in the operational privacy queue BEFORE removing the
    // row, so operators retain an auditable record (the request row has no FK to
    // the user and survives deletion). Self-service deletion is already fulfilled.
    await this.privacyService.recordAccountDeletion(userId, user.email, "self_service", "completed");

    const result = await this.usersRepo.delete({ id: userId });
    return (result.affected ?? 0) > 0;
  }

  private tryDeleteUpload(url: string): void {
    try {
      const key = url.split("/").pop();
      if (!key) return;
      void this.uploadsService.deleteFile(key).catch(() => {});
    } catch {
      // ignore
    }
  }

  private tryDeleteCompositionAssets(composition: unknown): void {
    if (!composition || typeof composition !== "object") return;
    const comp = composition as { layers?: Array<{ photoUri?: string; imageUri?: string }> };
    if (!Array.isArray(comp.layers)) return;

    for (const layer of comp.layers) {
      if (layer.photoUri) this.tryDeleteUpload(layer.photoUri);
      if (layer.imageUri) this.tryDeleteUpload(layer.imageUri);
    }
  }
}
