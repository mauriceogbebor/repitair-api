import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";

function validateEnvironment(): void {
  const log = new Logger("EnvironmentValidation");
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  if (isProduction) {
    if (!process.env.DATABASE_URL) errors.push("DATABASE_URL is required");
    if (!process.env.JWT_SECRET) errors.push("JWT_SECRET is required");
    if (!process.env.ADMIN_JWT_SECRET) errors.push("ADMIN_JWT_SECRET is required");

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

  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    warnings.push("Spotify credentials missing (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET) — Spotify song lookup will fail");
  }
  if (!process.env.APPLE_MUSIC_TEAM_ID || !process.env.APPLE_MUSIC_KEY_ID || !process.env.APPLE_MUSIC_PRIVATE_KEY) {
    warnings.push("Apple Music credentials missing (APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY) — Apple Music lookup will fail");
  } else if (!process.env.APPLE_MUSIC_PRIVATE_KEY.includes("BEGIN PRIVATE KEY")) {
    warnings.push("APPLE_MUSIC_PRIVATE_KEY does not look like a PEM private key — Apple Music lookup may fail");
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    warnings.push("SMTP credentials missing (SMTP_HOST, SMTP_USER, SMTP_PASS) — email sending will fail");
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

  const defaultCorsOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "https://repitair.com",
    "https://www.repitair.com",
  ];

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : defaultCorsOrigins;

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

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

void bootstrap();
