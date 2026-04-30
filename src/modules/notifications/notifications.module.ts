import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { PushToken } from "../../entities";

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([PushToken])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
