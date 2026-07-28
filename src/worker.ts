import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
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
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  const worker = app.get(PlatformJobWorker);
  const queues = process.env.QUEUES?.split(",").map((q) => q.trim()).filter(Boolean);
  worker.start(queues && queues.length ? queues : undefined);
  logger.log("Repitair platform job worker running");

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal} — draining worker`);
    worker.stop();
    // Give an in-flight job a moment to finish before closing the context.
    await new Promise((r) => setTimeout(r, 3_000));
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void bootstrap();
