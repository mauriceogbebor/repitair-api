import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module";
import { MusicConnectionsModule } from "../music/music-connections.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [UsersModule, MusicConnectionsModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
