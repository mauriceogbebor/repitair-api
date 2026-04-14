import { Body, Controller, Post, UseGuards } from "@nestjs/common";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RegisterTokenDto } from "./dto/register-token.dto";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post("register-token")
  registerToken(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: RegisterTokenDto
  ) {
    return this.notificationsService.registerToken(
      user.sub,
      body.pushToken,
      body.platform as "ios" | "android"
    );
  }
}
