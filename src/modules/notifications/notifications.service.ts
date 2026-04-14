import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { PushToken } from "../../entities";

export type { PushToken as PushTokenRecord };

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(PushToken)
    private readonly tokensRepo: Repository<PushToken>,
  ) {}

  async registerToken(
    userId: string,
    pushToken: string,
    platform: "ios" | "android"
  ): Promise<PushToken> {
    // Remove any existing token for this user and platform
    await this.tokensRepo.delete({
      userId,
      platform,
    });

    const now = new Date();
    const token = this.tokensRepo.create({
      userId,
      pushToken,
      platform,
      createdAt: now,
      updatedAt: now,
    });

    return this.tokensRepo.save(token);
  }

  async removeToken(userId: string, platform: "ios" | "android"): Promise<boolean> {
    const result = await this.tokensRepo.delete({
      userId,
      platform,
    });

    return !!(result.affected && result.affected > 0);
  }

  getTokensForUser(userId: string): Promise<PushToken[]> {
    return this.tokensRepo.find({
      where: { userId },
    });
  }
}
