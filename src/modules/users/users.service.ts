import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, ILike, QueryFailedError } from "typeorm";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { User } from "../../entities";
import { UploadsService } from "../uploads/uploads.service";
import { PrivacyService } from "../privacy/privacy.service";
import { MailService } from "../../common/services/mail.service";
import { renderBrandedEmail } from "../../common/services/email-template";

export type { User as UserRecord };

const PG_UNIQUE_VIOLATION = "23505";

/** Minimum gap between email-change requests for one user (request rate limit). */
const EMAIL_CHANGE_REQUEST_COOLDOWN_MS = 60 * 1000;
/** How long a pending email confirmation code is valid. */
const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;
/** Failed confirmation attempts that void the pending change. */
const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
/** Password accounts reauthenticate with their password. Social-only accounts
 * must present an access token whose authTime was established by their own
 * provider login inside this window. A user-wide lastLoginAt timestamp is not a
 * valid proof because a different session can refresh it.
 */
const SOCIAL_RECENT_AUTH_WINDOW_MS = 15 * 60 * 1000;
const RESERVED_SOCIAL_EMAIL_SUFFIXES = ["@users.repitair.com", "@social.repitair.invalid"];

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
  "pendingEmail",
  "pendingEmailCodeHash",
  "pendingEmailExpiresAt",
  "pendingEmailAttempts",
  "pendingEmailRequestedAt",
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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly uploadsService: UploadsService,
    private readonly privacyService: PrivacyService,
    private readonly mailService: MailService,
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
    const normalizedEmail = data.email.trim().toLowerCase();
    if (RESERVED_SOCIAL_EMAIL_SUFFIXES.some((suffix) => normalizedEmail.endsWith(suffix))) {
      throw new BadRequestException("Please use a valid personal email address");
    }
    const existing = await this.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = this.usersRepo.create({
      fullName: data.fullName,
      email: normalizedEmail,
      country: data.country,
      passwordHash,
      connectedPlatforms: [],
      signupSource: data.signupSource ?? "email",
      // Email signup sets a real password the user chose.
      hasUsablePassword: true,
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

  /**
   * Create a user originating from a social provider. Sets a random (unusable)
   * password and, optionally, a social avatar. Used by identity resolution when
   * no existing account can be safely linked.
   */
  async createSocialUser(data: {
    fullName: string;
    email: string;
    avatarUrl?: string;
    signupSource: string;
  }): Promise<User> {
    const randomPassword = randomBytes(32).toString("base64url");
    const passwordHash = await bcrypt.hash(randomPassword, 10);

    const user = this.usersRepo.create({
      fullName: data.fullName,
      email: data.email.toLowerCase(),
      country: "",
      passwordHash,
      connectedPlatforms: [],
      signupSource: data.signupSource,
      avatarUrl: data.avatarUrl?.trim() || undefined,
      // Random password — not usable for email/password login until the user
      // intentionally sets one (via password reset).
      hasUsablePassword: false,
    });

    try {
      return await this.usersRepo.save(user);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Never return the row that won an email race. The caller may be in the
        // middle of linking a provider subject, and adopting that row would
        // recreate the social-account pre-hijacking vulnerability.
        throw new ConflictException("An account with this email already exists");
      }
      throw err;
    }
  }

  /** Adopt a social-provider image only when the user has no avatar yet. */
  async setAvatarIfMissing(userId: string, url: string | null): Promise<void> {
    const trimmed = url?.trim();
    if (!trimmed) return;
    const user = await this.findById(userId);
    if (!user || user.avatarUrl) return;
    user.avatarUrl = trimmed;
    await this.usersRepo.save(user);
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
    // Store only the hash of the token — like the reset code, the raw value must
    // not sit in the database (a backup/read leak within the 10-min window
    // otherwise yields a usable reset token). The raw token is returned to the
    // client and never persisted server-side.
    user.resetToken = this.hashCode(resetToken);
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
    const received = Buffer.from(this.hashCode(resetToken), "utf8");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return false;
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetCode = undefined;
    user.resetCodeExpiresAt = undefined;
    user.resetToken = undefined;
    user.resetTokenExpiresAt = undefined;
    // The user has now intentionally set a password — enable email/password login
    // (this is how a social-only account opts into a password).
    user.hasUsablePassword = true;
    // Invalidate every previously issued access/refresh token so a compromised
    // session cannot survive a password reset.
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;

    await this.usersRepo.save(user);

    return true;
  }

  /**
   * Update mutable profile fields. Email is intentionally NOT accepted here:
   * changing the primary email is a security-sensitive operation that must go
   * through the verified pending-email workflow ({@link requestEmailChange} /
   * {@link confirmEmailChange}), which proves control of the new address before
   * replacing it. Any `email` supplied to this method is ignored.
   */
  async updateProfile(
    userId: string,
    data: { fullName?: string; country?: string; avatarUrl?: string },
  ): Promise<User | null> {
    const user = await this.findById(userId);
    if (!user) return null;

    if (data.fullName !== undefined) user.fullName = data.fullName;
    if (data.country !== undefined) user.country = data.country;
    if (data.avatarUrl !== undefined) {
      user.avatarUrl = data.avatarUrl.trim() || undefined;
    }

    return this.usersRepo.save(user);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Step 1 of an email change. Requires a recent-authentication proof, stages
   * the new (normalized) address, and emails a single-use code to it. Only a
   * hash of the code is stored. The response is intentionally uniform: it never
   * reveals whether the target address already belongs to another account.
   *
   * @returns the raw code ONLY for a genuinely stageable change (tests/dev);
   *          production callers email it and discard it. Returns null when the
   *          request was accepted but not staged (e.g. address already in use).
   */
  async requestEmailChange(
    userId: string,
    rawNewEmail: string,
    currentPassword?: string,
    sessionAuthTimeSeconds?: number,
  ): Promise<{ staged: boolean; code: string | null }> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    const newEmail = this.normalizeEmail(rawNewEmail);
    if (newEmail === user.email) {
      throw new BadRequestException("That is already your email address.");
    }

    // Recent-authentication proof.
    if (user.hasUsablePassword) {
      if (!currentPassword || !(await this.validatePassword(user, currentPassword))) {
        throw new UnauthorizedException("Your current password is required to change your email.");
      }
    } else {
      // Social-only account: the proof must belong to THIS bearer session. Do
      // not consult user.lastLoginAt: another session can update that value.
      const authTimeMs = Number.isFinite(sessionAuthTimeSeconds)
        ? Number(sessionAuthTimeSeconds) * 1000
        : 0;
      if (authTimeMs <= 0 || Date.now() - authTimeMs > SOCIAL_RECENT_AUTH_WINDOW_MS) {
        throw new UnauthorizedException("Please sign in again before changing your email.");
      }
    }

    // Request rate limit (per user).
    if (
      user.pendingEmailRequestedAt &&
      Date.now() - new Date(user.pendingEmailRequestedAt).getTime() < EMAIL_CHANGE_REQUEST_COOLDOWN_MS
    ) {
      throw new BadRequestException("Please wait a moment before requesting another email change.");
    }

    // Enumeration-safe: if the address already belongs to another account we
    // accept the request and return the same shape, but stage nothing and send
    // no code — the caller cannot distinguish "taken" from "sent".
    const existing = await this.findByEmail(newEmail);
    if (existing && existing.id !== userId) {
      user.pendingEmailRequestedAt = new Date();
      await this.usersRepo.save(user);
      return { staged: false, code: null };
    }

    const code = String(randomInt(100000, 1000000));
    user.pendingEmail = newEmail;
    user.pendingEmailCodeHash = this.hashCode(code);
    user.pendingEmailExpiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
    user.pendingEmailAttempts = 0;
    user.pendingEmailRequestedAt = new Date();
    await this.usersRepo.save(user);

    // Best-effort delivery to the NEW address (proves control of that mailbox).
    try {
      await this.mailService.sendRaw({
        to: newEmail,
        subject: "Confirm your new Repitair email",
        html: renderBrandedEmail({
          preheader: "Confirm your new Repitair email address (code expires in 30 minutes).",
          heading: "Confirm your new email",
          intro: "Use this code to confirm this address on your Repitair account:",
          code,
          note: "This code expires in 30 minutes. If you didn't request this, you can ignore it — your current email stays unchanged.",
        }),
        sensitive: true,
      });
    } catch (err) {
      this.logger.error(`Failed to send email-change code: ${(err as Error).message}`);
    }

    return { staged: true, code };
  }

  /**
   * Step 2 of an email change. Verifies the single-use code, then atomically
   * swaps the primary email to the pending address, marks it verified, clears
   * all pending state, and bumps `sessionVersion` to revoke existing sessions.
   * A uniqueness collision that appeared between request and confirmation is
   * surfaced (never a silent/false success) and the pending change is cleared.
   */
  async confirmEmailChange(userId: string, code: string): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    if (!user.pendingEmail || !user.pendingEmailCodeHash || !user.pendingEmailExpiresAt) {
      throw new BadRequestException("There is no pending email change to confirm.");
    }

    if (new Date(user.pendingEmailExpiresAt) < new Date()) {
      await this.clearPendingEmail(user);
      throw new BadRequestException("Your email confirmation code has expired.");
    }

    if (user.pendingEmailAttempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
      await this.clearPendingEmail(user);
      throw new BadRequestException("Too many attempts. Please request the email change again.");
    }

    const expected = Buffer.from(user.pendingEmailCodeHash, "utf8");
    const received = Buffer.from(this.hashCode(code), "utf8");
    const matches = expected.length === received.length && timingSafeEqual(expected, received);
    if (!matches) {
      user.pendingEmailAttempts += 1;
      await this.usersRepo.save(user);
      throw new BadRequestException("That confirmation code is incorrect.");
    }

    const pending = user.pendingEmail;
    user.email = pending;
    user.emailVerified = true;
    // Revoke every previously issued session — the identity backing them changed.
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    this.resetPendingEmailFields(user);

    try {
      return await this.usersRepo.save(user);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Someone claimed this address between request and confirmation. Do not
        // report success; clear the stale pending change and surface the clash.
        const fresh = await this.findById(userId);
        if (fresh) {
          this.resetPendingEmailFields(fresh);
          await this.usersRepo.save(fresh);
        }
        throw new ConflictException("That email address is no longer available.");
      }
      throw err;
    }
  }

  private resetPendingEmailFields(user: User): void {
    user.pendingEmail = null;
    user.pendingEmailCodeHash = null;
    user.pendingEmailExpiresAt = null;
    user.pendingEmailAttempts = 0;
    user.pendingEmailRequestedAt = null;
  }

  private async clearPendingEmail(user: User): Promise<void> {
    this.resetPendingEmailFields(user);
    await this.usersRepo.save(user);
  }

  async changePassword(userId: string, newPassword: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user) return false;

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.hasUsablePassword = true;
    // Revoke previously issued tokens on an explicit password change too.
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
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
