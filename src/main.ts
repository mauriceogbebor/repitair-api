import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";

async function bootstrap() {
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
    : ["http://localhost:3000", "http://localhost:3001"];

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
  });

  // Required for correct client IP resolution behind a proxy/load balancer.
  // Without this, req.ip is the proxy's IP and per-IP rate limits degrade
  // into a single shared bucket across all users.
  //
  // Set TRUST_PROXY:
  //   - "true" to trust all hops (convenient but lets a client spoof X-Forwarded-For
  //     if they reach the app directly)
  //   - a number like "1" or "2" for the number of trusted proxy hops
  //   - an IP or CIDR list for specific proxies
  // Default is "1" hop (common for most hosted platforms like Render/Railway/Fly).
  const trustProxy = process.env.TRUST_PROXY ?? "1";
  const parsedTrustProxy = /^\d+$/.test(trustProxy)
    ? Number(trustProxy)
    : trustProxy === "true"
      ? true
      : trustProxy;
  app.set("trust proxy", parsedTrustProxy);

  app.setGlobalPrefix("api");

  // Add body size limits to prevent abuse
  app.use(require("express").json({ limit: "10mb" }));
  app.use(require("express").urlencoded({ limit: "10mb", extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

void bootstrap();
