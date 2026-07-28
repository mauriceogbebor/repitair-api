import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { User } from "../../entities";
import { UploadsModule } from "../uploads/uploads.module";
import { PrivacyModule } from "../privacy/privacy.module";

@Module({
  imports: [TypeOrmModule.forFeature([User]), UploadsModule, PrivacyModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
