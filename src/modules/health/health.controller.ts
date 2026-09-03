import { Controller, Get, Inject, Optional, ServiceUnavailableException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { isRedisReady, REDIS_CLIENT } from "../../common/modules/redis.module";

@Controller("health")
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: any | null,
  ) {}

  @Get()
  async getHealth() {
    let dbStatus = "ok";
    try {
      await this.dataSource.query("SELECT 1");
    } catch {
      dbStatus = "degraded";
    }

    return {
      status: dbStatus === "ok" ? "ok" : "degraded",
      service: "repitair-backend",
      database: dbStatus,
      uptime: process.uptime(),
    };
  }

  /** Lightweight liveness probe for container orchestration */
  @Get("live")
  getLive() {
    return { status: "ok" };
  }

  /** Dependency-aware readiness probe used for traffic admission. */
  @Get("ready")
  async getReady() {
    try {
      if (!isRedisReady(this.redis)) throw new Error("Redis is not ready");
      await Promise.all([
        this.dataSource.query("SELECT 1"),
        this.redis.ping(),
      ]);
      return { status: "ok", database: "ok", redis: "ok" };
    } catch {
      throw new ServiceUnavailableException({
        status: "unavailable",
        dependencies: "unavailable",
      });
    }
  }
}
