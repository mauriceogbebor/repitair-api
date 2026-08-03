import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { MusicController } from "./music.controller";
import { MusicCollectionsController } from "./music-collections.controller";
import { MusicConnectionsModule } from "./music-connections.module";
import { MusicLibraryService } from "./music-library.service";
import { MusicService } from "./music.service";
import { MusicCollection, MusicPlaylistImport, User } from "../../entities";

@Module({
  imports: [TypeOrmModule.forFeature([User, MusicCollection, MusicPlaylistImport]), MusicConnectionsModule],
  controllers: [MusicController, MusicCollectionsController],
  providers: [MusicService, MusicLibraryService],
})
export class MusicModule {}
