import { ConflictException, Injectable, OnModuleInit } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type UserRecord = {
  id: string;
  fullName: string;
  email: string;
  country: string;
  passwordHash: string;
  connectedPlatforms: string[];
  createdAt: string;
  resetCode?: string;
  resetCodeExpiresAt?: string;
};

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly storagePath = join(process.cwd(), "data", "users.json");
  private users: UserRecord[] = [];
  private nextId = 1;
  private writeQueue: Promise<void> = Promise.resolve();

  async onModuleInit() {
    this.users = await this.readUsers();
    this.nextId = this.getNextId(this.users);
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    return this.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    return this.users.find((u) => u.id === id);
  }

  async createUser(data: {
    fullName: string;
    email: string;
    country: string;
    password: string;
  }): Promise<UserRecord> {
    const existing = await this.findByEmail(data.email);
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const user: UserRecord = {
      id: `user_${this.nextId}`,
      fullName: data.fullName,
      email: data.email.toLowerCase(),
      country: data.country,
      passwordHash,
      connectedPlatforms: [],
      createdAt: new Date().toISOString(),
    };

    this.nextId += 1;
    this.users = [...this.users, user];
    await this.persist();

    return user;
  }

  async validatePassword(user: UserRecord, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async setResetCode(email: string): Promise<string | null> {
    const user = await this.findByEmail(email);
    if (!user) return null;

    const code = String(Math.floor(1000 + Math.random() * 9000));
    user.resetCode = code;
    user.resetCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    this.users = this.users.map((u) => (u.id === user.id ? user : u));
    await this.persist();

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

    this.users = this.users.map((u) => (u.id === user.id ? user : u));
    await this.persist();

    return true;
  }

  async updateProfile(
    userId: string,
    data: { fullName?: string; email?: string },
  ): Promise<UserRecord | null> {
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

    this.users = this.users.map((u) => (u.id === user.id ? user : u));
    await this.persist();

    return user;
  }

  async changePassword(userId: string, newPassword: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user) return false;

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    this.users = this.users.map((u) => (u.id === user.id ? user : u));
    await this.persist();

    return true;
  }

  async connectPlatform(userId: string, platform: string): Promise<UserRecord | null> {
    const user = await this.findById(userId);
    if (!user) return null;

    if (!user.connectedPlatforms.includes(platform)) {
      user.connectedPlatforms = [...user.connectedPlatforms, platform];
      this.users = this.users.map((u) => (u.id === user.id ? user : u));
      await this.persist();
    }

    return user;
  }

  private async readUsers(): Promise<UserRecord[]> {
    try {
      const raw = await readFile(this.storagePath, "utf8");
      return JSON.parse(raw) as UserRecord[];
    } catch {
      await this.persist();
      return [];
    }
  }

  private getNextId(users: UserRecord[]) {
    const max = users.reduce((m, u) => {
      const n = Number(u.id.replace("user_", ""));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return max + 1;
  }

  private async persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.storagePath), { recursive: true });
      await writeFile(this.storagePath, JSON.stringify(this.users, null, 2), "utf8");
    });
    await this.writeQueue;
  }
}
