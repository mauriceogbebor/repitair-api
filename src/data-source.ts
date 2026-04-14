import "reflect-metadata";
import { DataSource } from "typeorm";
import { config as dotenvConfig } from "dotenv";

import { User, Repit, PushToken } from "./entities";

dotenvConfig();

/**
 * Standalone DataSource used ONLY by the TypeORM CLI for generating and
 * running migrations. The runtime app config lives in app.module.ts.
 *
 * Keep these two in sync when you add entities or change connection options.
 *
 * - In development (ts-node), migrations are loaded from src as .ts files.
 * - In production (compiled), migrations are loaded from dist as .js files.
 */
const isCompiled = __filename.endsWith(".js");

export default new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL || "postgresql://repitair:repitair@localhost:5432/repitair",
  entities: [User, Repit, PushToken],
  migrations: [isCompiled ? "dist/migrations/*.js" : "src/migrations/*.ts"],
  synchronize: false,
  logging: true,
});
