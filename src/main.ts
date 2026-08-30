import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";
import { resolveCorsOrigins } from "./common/config/cors-origins";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { spotifyRedirectUriProblem } from "./modules/auth/spotify-redirect-uri";

function setupSwagger(app: NestExpressApplication): void {
  const isEnabled =
    process.env.SWAGGER_ENABLED === "true" || process.env.NODE_ENV !== "production";

  if (!isEnabled) return;

  const config = new DocumentBuilder()
    .setTitle("Repitair API")
    .setDescription("Consumer and administration API documentation for Repitair.")
    .setVersion("1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "user-access-token",
    )
    .addCookieAuth(
      "ra_admin_session",
      { type: "apiKey", in: "cookie" },
      "admin-session",
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document, {
    useGlobalPrefix: true,
    swaggerOptions: { persistAuthorization: true },
  });

  new Logger("Swagger").log("Swagger UI available at /api/docs");
}

function validateEnvironment(): void {
  const log = new Logger("EnvironmentValidation");
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  if (isProduction) {
    if (!process.env.DATABASE_URL) errors.push("DATABASE_URL is required");
    if (!process.env.JWT_SECRET) errors.push("JWT_SECRET is required");
    if (!process.env.JWT_REFRESH_SECRET) errors.push("JWT_REFRESH_SECRET is required");
    if (!process.env.ADMIN_JWT_SECRET) errors.push("ADMIN_JWT_SECRET is required");
    if (!process.env.ADMIN_FRONTEND_ORIGIN) errors.push("ADMIN_FRONTEND_ORIGIN is required");
    if (!process.env.PUBLIC_URL) errors.push("PUBLIC_URL is required");
    if (!process.env.MUSIC_TOKEN_ENCRYPTION_KEY) {
      errors.push("MUSIC_TOKEN_ENCRYPTION_KEY is required for encrypted music-provider authorization");
    } else {
      const musicTokenKey = process.env.MUSIC_TOKEN_ENCRYPTION_KEY.trim();
      const isHexKey = /^[0-9a-f]{64}$/i.test(musicTokenKey);
      const isBase64Key = !isHexKey && Buffer.from(musicTokenKey, "base64").length === 32;
      if (!isHexKey && !isBase64Key) {
        errors.push("MUSIC_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hex characters");
      }
    }
    if (process.env.ADMIN_COOKIE_SECURE === "false") errors.push("ADMIN_COOKIE_SECURE cannot be false in production");

    const sameSite = process.env.ADMIN_COOKIE_SAME_SITE;
    if (!sameSite || !["lax", "strict", "none"].includes(sameSite)) {
      errors.push("ADMIN_COOKIE_SAME_SITE must be one of: lax, strict, none");
    }
    if (sameSite === "none" && process.env.ADMIN_COOKIE_SECURE === "false") {
      errors.push("ADMIN_COOKIE_SECURE must be true when ADMIN_COOKIE_SAME_SITE=none");
    }

    const cookiePath = process.env.ADMIN_COOKIE_PATH ?? "/api/admin";
    if (!cookiePath.startsWith("/api/admin")) {
      errors.push("ADMIN_COOKIE_PATH must be scoped to /api/admin in production");
    }

    try {
      const adminOrigin = new URL(process.env.ADMIN_FRONTEND_ORIGIN ?? "");
      if (adminOrigin.origin !== process.env.ADMIN_FRONTEND_ORIGIN || adminOrigin.protocol !== "https:") {
        errors.push("ADMIN_FRONTEND_ORIGIN must be an HTTPS origin without a path in production");
      }
    } catch {
      errors.push("ADMIN_FRONTEND_ORIGIN must be a valid URL origin");
    }

    try {
      const publicUrl = new URL(process.env.PUBLIC_URL ?? "");
      const normalized = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
      if (publicUrl.origin !== normalized || publicUrl.protocol !== "https:") {
        errors.push("PUBLIC_URL must be an HTTPS origin without a path in production");
      }
    } catch {
      errors.push("PUBLIC_URL must be a valid URL origin");
    }

    if ((process.env.CORS_ORIGINS ?? "").split(",").some((origin) => origin.trim() === "*")) {
      errors.push("CORS_ORIGINS cannot contain '*' when credentialed admin sessions are enabled");
    }

    if (!process.env.UPLOAD_PROVIDER || process.env.UPLOAD_PROVIDER === "local") {
      errors.push("UPLOAD_PROVIDER must be 's3' in production (files are lost on redeploy with 'local')");
    }
  }

  if (process.env.UPLOAD_PROVIDER === "s3") {
    const s3Vars = ["AWS_S3_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
    for (const variableName of s3Vars) {
      if (!process.env[variableName]) {
        errors.push(`${variableName} is required when UPLOAD_PROVIDER=s3`);
      }
    }
  }

  if (!process.env.SPOTIFY_CLIENT_ID) {
    warnings.push("Spotify credentials missing (SPOTIFY_CLIENT_ID) — Spotify song lookup and account connection will fail");
  }
  {
    const redirectProblem = spotifyRedirectUriProblem(process.env.SPOTIFY_REDIRECT_URI);
    if (process.env.SPOTIFY_CLIENT_ID && redirectProblem) {
      warnings.push(`Spotify account connection will fail — ${redirectProblem}`);
    }
  }
  if (!process.env.APPLE_MUSIC_TEAM_ID || !process.env.APPLE_MUSIC_KEY_ID || !process.env.APPLE_MUSIC_PRIVATE_KEY) {
    warnings.push("Apple Music credentials missing (APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY) — Apple Music lookup will fail");
  } else if (!process.env.APPLE_MUSIC_PRIVATE_KEY.includes("BEGIN PRIVATE KEY")) {
    warnings.push("APPLE_MUSIC_PRIVATE_KEY does not look like a PEM private key — Apple Music lookup may fail");
  }
  const hasSendGridEmail = Boolean(process.env.SENDGRID_API_KEY);
  const hasSmtpEmail = Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
  if (!hasSendGridEmail && !hasSmtpEmail) {
    warnings.push(
      "Email delivery credentials missing (SENDGRID_API_KEY or SMTP_HOST, SMTP_USER, SMTP_PASS) — email sending will fail",
    );
  }
  if (!process.env.ADMIN_BOOTSTRAP_EMAIL || !process.env.ADMIN_BOOTSTRAP_PASSWORD || !process.env.ADMIN_BOOTSTRAP_MFA_SECRET) {
    warnings.push("Admin bootstrap credentials missing (ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD, ADMIN_BOOTSTRAP_MFA_SECRET) — the first admin account will not be auto-created");
  }

  for (const warning of warnings) log.warn(warning);

  if (errors.length > 0) {
    for (const error of errors) log.error(error);
    throw new Error(`Environment validation failed with ${errors.length} error(s):\n  - ${errors.join("\n  - ")}`);
  }

  log.log("Environment validation passed");
}

async function bootstrap() {
  validateEnvironment();

  const corsOrigins = resolveCorsOrigins();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        if (corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
      },
      credentials: true,
      exposedHeaders: [
        "Content-Disposition",
        "X-Export-Result-Count",
        "X-Export-Limit",
        "X-Export-Truncated",
      ],
    },
  });

  const trustProxy = process.env.TRUST_PROXY ?? "1";
  const parsedTrustProxy = /^\d+$/.test(trustProxy)
    ? Number(trustProxy)
    : trustProxy === "true"
      ? true
      : trustProxy;
  app.set("trust proxy", parsedTrustProxy);

  app.setGlobalPrefix("api");
  app.use(require("express").json({ limit: "10mb" }));
  app.use(require("express").urlencoded({ limit: "10mb", extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  setupSwagger(app);

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

void bootstrap();
