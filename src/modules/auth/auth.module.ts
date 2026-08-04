import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module";
import { MusicConnectionsModule } from "../music/music-connections.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AppleIdentityService } from "./apple-identity.service";

@Module({
  imports: [UsersModule, MusicConnectionsModule],
  controllers: [AuthController],
  providers: [AuthService, AppleIdentityService],
  exports: [AuthService],
})
export class AuthModule {}
