import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { PushToken } from "../../entities";

@Module({
  imports: [TypeOrmModule.forFeature([PushToken])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
