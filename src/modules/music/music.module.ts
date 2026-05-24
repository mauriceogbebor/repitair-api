import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { MusicController } from "./music.controller";
import { MusicService } from "./music.service";
import { User } from "../../entities";

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [MusicController],
  providers: [MusicService],
})
export class MusicModule {}
