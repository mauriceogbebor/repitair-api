import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { SocialIdentity } from "../../entities";
import { UsersModule } from "../users/users.module";
import { MusicConnectionsModule } from "../music/music-connections.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AppleIdentityService } from "./apple-identity.service";
import { SocialIdentityService } from "./social-identity.service";

@Module({
  imports: [TypeOrmModule.forFeature([SocialIdentity]), UsersModule, MusicConnectionsModule],
  controllers: [AuthController],
  providers: [AuthService, AppleIdentityService, SocialIdentityService],
  exports: [AuthService],
})
export class AuthModule {}
