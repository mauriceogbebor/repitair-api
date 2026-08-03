import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { MusicConnection, MusicOAuthState, User } from "../../entities";
import { MusicConnectionsService } from "./music-connections.service";

@Module({
  imports: [TypeOrmModule.forFeature([MusicConnection, MusicOAuthState, User])],
  providers: [MusicConnectionsService],
  exports: [MusicConnectionsService],
})
export class MusicConnectionsModule {}
