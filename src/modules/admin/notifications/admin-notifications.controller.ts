import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AdminRequest } from "../admin.types";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminNotificationsService } from "./admin-notifications.service";
import { AdminNotificationActionDto } from "./dto/admin-notification-action.dto";
import { AdminNotificationScheduleDto } from "./dto/admin-notification-schedule.dto";
import { AdminCreateNotificationDto } from "./dto/admin-create-notification.dto";
import { AdminListNotificationsQueryDto } from "./dto/admin-list-notifications-query.dto";
import { AdminUpdateNotificationDto } from "./dto/admin-update-notification.dto";

@Controller("admin/notifications")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminNotificationsController {
  constructor(private readonly adminNotificationsService: AdminNotificationsService) {}

  @Get()
  @AdminPermissions("notifications.read")
  async listNotifications(@Query() query: AdminListNotificationsQueryDto) {
    return this.adminNotificationsService.listNotifications(query);
  }

  @Get(":id")
  @AdminPermissions("notifications.read")
  async getNotification(@Param("id") notificationId: string) {
    return this.adminNotificationsService.getNotificationDetail(notificationId);
  }

  @Post()
  @AdminPermissions("notifications.write")
  async createNotification(@Body() dto: AdminCreateNotificationDto, @Req() req: AdminRequest) {
    return this.adminNotificationsService.createNotification(dto, req.adminUser, req.adminRequestContext);
  }

  @Patch(":id")
  @AdminPermissions("notifications.write")
  async updateNotification(@Param("id") notificationId: string, @Body() dto: AdminUpdateNotificationDto, @Req() req: AdminRequest) {
    return this.adminNotificationsService.updateNotification(notificationId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/send")
  @AdminPermissions("notifications.send")
  async sendNotification(@Param("id") notificationId: string, @Body() dto: AdminNotificationActionDto, @Req() req: AdminRequest) {
    return this.adminNotificationsService.sendNotification(notificationId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/schedule")
  @AdminPermissions("notifications.schedule")
  async scheduleNotification(@Param("id") notificationId: string, @Body() dto: AdminNotificationScheduleDto, @Req() req: AdminRequest) {
    return this.adminNotificationsService.scheduleNotification(notificationId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/cancel")
  @AdminPermissions("notifications.cancel")
  async cancelNotification(@Param("id") notificationId: string, @Body() dto: AdminNotificationActionDto, @Req() req: AdminRequest) {
    return this.adminNotificationsService.cancelNotification(notificationId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/duplicate")
  @AdminPermissions("notifications.write")
  async duplicateNotification(@Param("id") notificationId: string, @Req() req: AdminRequest) {
    return this.adminNotificationsService.duplicateNotification(notificationId, req.adminUser, req.adminRequestContext);
  }
}
