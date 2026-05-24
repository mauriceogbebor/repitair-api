import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, ILike, QueryFailedError } from "typeorm";
import * as bcrypt from "bcryptjs";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { User } from "../../entities";
import { UploadsService } from "../uploads/uploads.service";

export type { User as UserRecord };

// Postgres unique-violation SQLSTATE code
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION;
}

function isMissingAvatarUrlColumn(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) {
    return false;
  }

  const message = String((err as QueryFailedError & { message?: string }).message ?? "");
  return message.includes("avatarUrl");
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly uploadsService: UploadsService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.usersRepo.findOne({
        where: { email: ILike(email) },
      });
    } catch (err) {
      if (isMissingAvatarUrlColumn(err)) {
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
      if (isMissingAvatarUrlColumn(err)) {
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
        "user.resetToken",
        "user.resetTokenExpiresAt",
        "user.resetCodeAttempts",
        "user.emailVerified",
        "user.emailVerifyCode",
        "user.emailVerifyCodeExpiresAt",
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
        "user.resetToken",
        "user.resetTokenExpiresAt",
        "user.resetCodeAttempts",
        "user.emailVerified",
        "user.emailVerifyCode",
        "user.emailVerifyCodeExpiresAt",
      ])
      .where("user.id = :id", { id })
      .getOne();
  }

  async createUser(data: {
    fullName: string;
    email: string;
    country: string;
    password: string;
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
    });

    try {
      return await this.usersRepo.save(user);
    } catch (err) {
      // Guards against race: two concurrent signups with the same email can
      // both pass the findByEmail check, and the DB's unique constraint catches
      // the second one. Convert it back into a clean 409 instead of a 500.
      if (isUniqueViolation(err)) {
        throw new ConflictException("An account with this email already exists");
      }
      throw err;
    }
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async setResetCode(email: string): Promise<string | null> {
    const user = await this.findByEmail(email);
    if (!user) return null;

    // 6-digit code using CSPRNG. The previous implementation used Math.random()
    // (insecure) and only 4 digits (brute-forceable in ~10k attempts).
    const code = String(randomInt(100000, 1000000));
    user.resetCode = code;
    user.resetCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    user.resetCodeAttempts = 0; // reset attempt counter on new code

    await this.usersRepo.save(user);

    return code;
  }

  /**
   * Verify a reset code. On success, issues an opaque reset token (valid 10 min)
   * that must be presented to `resetPassword` — this prevents the password from
   * being changed without completing the code-verification step.
   */
  async verifyResetCode(email: string, code: string): Promise<string | null> {
    const user = await this.findByEmail(email);
    if (!user || !user.resetCode || !user.resetCodeExpiresAt) return null;

    if (new Date(user.resetCodeExpiresAt) < new Date()) return null;

    // Lockout after 5 failed attempts — invalidate the code entirely
    if (user.resetCodeAttempts >= 5) {
      user.resetCode = undefined;
      user.resetCodeExpiresAt = undefined;
      user.resetCodeAttempts = 0;
      await this.usersRepo.save(user);
      return null;
    }

    if (user.resetCode !== code) {
      user.resetCodeAttempts += 1;
      await this.usersRepo.save(user);
      return null;
    }

    // Issue a one-time reset token
    const resetToken = randomBytes(32).toString("hex");
    user.resetToken = resetToken;
    user.resetTokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    // Consume the code so it can't be reused
    user.resetCode = undefined;
    user.resetCodeExpiresAt = undefined;

    await this.usersRepo.save(user);

    return resetToken;
  }

  /**
   * Reset a user's password. Requires a valid reset token obtained from
   * `verifyResetCode` — callers can no longer skip the verification step.
   */
  async resetPassword(email: string, resetToken: string, newPassword: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user || !user.resetToken || !user.resetTokenExpiresAt) return false;

    if (new Date(user.resetTokenExpiresAt) < new Date()) return false;

    // Constant-time comparison to prevent timing attacks
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

    // Only look up duplicate email if the email is actually changing.
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
      // Treat empty string as "remove avatar"
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

  /**
   * Generate and save an email verification code for a user.
   */
  async setEmailVerifyCode(userId: string): Promise<string | null> {
    const user = await this.findById(userId);
    if (!user) return null;

    const code = String(randomInt(100000, 1000000));
    user.emailVerifyCode = code;
    user.emailVerifyCodeExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min
    await this.usersRepo.save(user);
    return code;
  }

  /**
   * Verify the email verification code and mark the user as verified.
   */
  async verifyEmail(userId: string, code: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user || !user.emailVerifyCode || !user.emailVerifyCodeExpiresAt) return false;

    if (new Date(user.emailVerifyCodeExpiresAt) < new Date()) return false;
    if (user.emailVerifyCode !== code) return false;

    user.emailVerified = true;
    user.emailVerifyCode = undefined;
    user.emailVerifyCodeExpiresAt = undefined;
    await this.usersRepo.save(user);
    return true;
  }

  /**
   * Disconnect a music platform from the user's account.
   * Removes the stored tokens and updates the connectedPlatforms array.
   */
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

  /**
   * Permanently delete a user account and all associated data.
   * Cascading deletes handle repits and push tokens via DB constraints.
   * Uploaded files (avatar, repit photos) are cleaned up best-effort.
   */
  async deleteUser(userId: string): Promise<boolean> {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ["repits"],
    });
    if (!user) return false;

    // Best-effort cleanup of uploaded files
    if (user.avatarUrl) {
      this.tryDeleteUpload(user.avatarUrl);
    }
    for (const repit of user.repits ?? []) {
      if (repit.backgroundPhotoUrl) {
        this.tryDeleteUpload(repit.backgroundPhotoUrl);
      }
    }

    // CASCADE on the FK handles repits and push tokens
    const result = await this.usersRepo.delete({ id: userId });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Best-effort deletion of an uploaded file given its public URL.
   */
  private tryDeleteUpload(url: string): void {
    try {
      const key = url.split("/").pop();
      if (!key) return;
      void this.uploadsService.deleteFile(key).catch(() => {});
    } catch {
      // URL parse error — ignore.
    }
  }
}
