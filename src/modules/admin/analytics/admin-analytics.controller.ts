import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { AdminAnalyticsQueryDto } from "./admin-analytics-query.dto";

@Controller("admin/analytics")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get()
  @AdminPermissions("analytics.read")
  getOverview(@Query() query: AdminAnalyticsQueryDto) {
    return this.analytics.getOverview(query);
  }
}
