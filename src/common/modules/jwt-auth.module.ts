import { Global, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";

/**
 * Global JWT module — single source of truth for signing secret and expiry.
 * Consumed by AuthModule (for signing) and JwtAuthGuard (for verification).
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const jwtSecret = config.get<string>("JWT_SECRET");
        const nodeEnv = config.get<string>("NODE_ENV") ?? "development";

        // Fail fast in anything that isn't explicitly "development".
        // Previously we only failed in "production" which meant staging/preview
        // deployments could silently ship with the dev secret.
        if (nodeEnv !== "development" && !jwtSecret) {
          throw new Error(
            `JWT_SECRET is required when NODE_ENV=${nodeEnv}. Generate one with: openssl rand -base64 48`,
          );
        }

        if (!jwtSecret) {
          new Logger("JwtAuthModule").warn(
            "Using dev JWT secret — only safe in NODE_ENV=development",
          );
        }

        return {
          secret: jwtSecret ?? "dev-secret-change-me",
          signOptions: { expiresIn: "7d" },
        };
      },
    }),
  ],
  exports: [JwtModule],
})
export class JwtAuthModule {}
