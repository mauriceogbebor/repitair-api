import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AnalyticsEvent } from "../../entities/analytics-event.entity";
import { AnalyticsService } from "./analytics.service";

/**
 * Global so any service can inject AnalyticsService to emit events without each
 * feature module re-importing it.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsEvent])],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
