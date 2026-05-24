import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { Repository } from "typeorm";

import { PushToken } from "../../entities";

export type { PushToken as PushTokenRecord };

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly expo: Expo;

  constructor(
    @InjectRepository(PushToken)
    private readonly tokensRepo: Repository<PushToken>,
    private readonly configService: ConfigService,
  ) {
    const accessToken = this.configService.get<string>("EXPO_ACCESS_TOKEN");
    this.expo = new Expo({ accessToken: accessToken || undefined });
    if (!accessToken) {
      this.logger.warn(
        "EXPO_ACCESS_TOKEN not set — push notifications will be sent without authentication (rate-limited)",
      );
    }
  }

  async registerToken(
    userId: string,
    pushToken: string,
    platform: "ios" | "android"
  ): Promise<PushToken> {
    // Ensure a physical device token belongs to only one account at a time.
    // This prevents shared devices from receiving another user's notifications.
    await this.tokensRepo.delete({ pushToken });

    // Also remove any prior token for this user+platform so they keep one active
    // registration per platform even if Expo rotates the token.
    await this.tokensRepo.delete({ userId, platform });

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

  async unregisterToken(userId: string, pushToken: string): Promise<boolean> {
    const result = await this.tokensRepo.delete({
      userId,
      pushToken,
    });

    return !!(result.affected && result.affected > 0);
  }

  getTokensForUser(userId: string): Promise<PushToken[]> {
    return this.tokensRepo.find({
      where: { userId },
    });
  }

  /**
   * Send a push notification to all registered devices for a user.
   * Returns the number of messages successfully queued.
   */
  async sendToUser(
    userId: string,
    notification: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<number> {
    const tokens = await this.getTokensForUser(userId);
    if (tokens.length === 0) return 0;

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.pushToken))
      .map((t) => ({
        to: t.pushToken,
        sound: "default" as const,
        title: notification.title,
        body: notification.body,
        data: notification.data,
      }));

    if (messages.length === 0) {
      this.logger.warn(`No valid Expo push tokens for user ${userId}`);
      return 0;
    }

    const chunks = this.expo.chunkPushNotifications(messages);
    let sent = 0;

    for (const chunk of chunks) {
      try {
        const tickets: ExpoPushTicket[] = await this.expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === "ok") {
            sent++;
          } else {
            this.logger.warn(`Push notification error: ${ticket.message} (${ticket.details?.error})`);
          }
        }
      } catch (err) {
        this.logger.error(`Failed to send push notification chunk: ${(err as Error).message}`);
      }
    }

    return sent;
  }

  /**
   * Send a push notification to multiple users at once.
   */
  async sendToUsers(
    userIds: string[],
    notification: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<number> {
    let total = 0;
    for (const userId of userIds) {
      total += await this.sendToUser(userId, notification);
    }
    return total;
  }
}
