import { Module } from "@nestjs/common";

import { MusicController } from "./music.controller";

@Module({
  controllers: [MusicController],
})
export class MusicModule {}
