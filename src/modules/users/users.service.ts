import { ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, ILike, QueryFailedError } from "typeorm";
import * as bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

import { User } from "../../entities";

export type { User as UserRecord };

// Postgres unique-violation SQLSTATE code
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { email: ILike(email) },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { id },
    });
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

    await this.usersRepo.save(user);

    return code;
  }

  async verifyResetCode(email: string, code: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user || !user.resetCode || !user.resetCodeExpiresAt) return false;

    if (new Date(user.resetCodeExpiresAt) < new Date()) return false;

    return user.resetCode === code;
  }

  async resetPassword(email: string, newPassword: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user) return false;

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetCode = undefined;
    user.resetCodeExpiresAt = undefined;

    await this.usersRepo.save(user);

    return true;
  }

  async updateProfile(
    userId: string,
    data: { fullName?: string; email?: string; country?: string },
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

  async connectPlatform(userId: string, platform: string): Promise<User | null> {
    const user = await this.findById(userId);
    if (!user) return null;

    if (!user.connectedPlatforms.includes(platform)) {
      user.connectedPlatforms = [...user.connectedPlatforms, platform];
      await this.usersRepo.save(user);
    }

    return user;
  }

  async connectSpotify(userId: string, refreshToken: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    user.spotifyRefreshToken = refreshToken;
    if (!user.connectedPlatforms.includes("spotify")) {
      user.connectedPlatforms = [...user.connectedPlatforms, "spotify"];
    }

    await this.usersRepo.save(user);
  }
}
