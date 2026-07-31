import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AppModule } from "./app.module";
import { MediaStorageGateway } from "./modules/media/media-storage.gateway";
import { normalizeProviderId } from "./modules/media/providers/background-removal.provider";
import { PlatformJobWorker } from "./modules/platform-jobs/platform-job.worker";

/**
 * Standalone worker process. Deploy as a separate service:
 *   node dist/worker.js            (production, after `nest build`)
 *   QUEUES=privacy,notifications … (optional: restrict to specific queues)
 *
 * Boots the full Nest application context (no HTTP server) so every domain
 * handler is registered, then starts the durable-queue worker. Handles graceful
 * shutdown: stops claiming new work and lets the in-flight job finish/release.
 */
async function bootstrap() {
  const logger = new Logger("Worker");
  let shuttingDown = false;
  process.env.REPITAIR_PROCESS_ROLE = "worker";
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  const worker = app.get(PlatformJobWorker);
  const config = app.get(ConfigService);
  const dataSource = app.get(DataSource);
  const storage = app.get(MediaStorageGateway);
  const queues = process.env.QUEUES?.split(",").map((q) => q.trim()).filter(Boolean);
  await dataSource.query("SELECT 1");
  const storageHealth = await storage.healthCheck();
  if (!storageHealth.connected) throw new Error("Worker storage readiness probe failed");

  const environment = config.get<string>("RAILWAY_ENVIRONMENT_NAME")
    ?? config.get<string>("APP_ENV")
    ?? config.get<string>("NODE_ENV")
    ?? "unknown";
  const revision = config.get<string>("RAILWAY_GIT_COMMIT_SHA")
    ?? config.get<string>("COMMIT_SHA")
    ?? config.get<string>("SOURCE_VERSION")
    ?? "unknown";
  const provider = normalizeProviderId(config.get<string>("BG_REMOVAL_PROVIDER"));
  logger.log(
    `[WORKER] dependencies database=connected storage=connected`
    + ` storageProvider=${storageHealth.provider} provider=${provider}`,
  );
  await worker.start(queues && queues.length ? queues : undefined, {
    environment,
    revision,
    provider,
    storageProvider: storageHealth.provider,
  });

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`[WORKER] draining signal=${signal}`);
    worker.stop();
    // Give an in-flight job a moment to finish before closing the context.
    await new Promise((r) => setTimeout(r, 3_000));
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

void bootstrap();
