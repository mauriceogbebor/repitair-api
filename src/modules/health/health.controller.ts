import { Controller, Get } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

@Controller("health")
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
}
