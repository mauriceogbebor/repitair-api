import { Module } from "@nestjs/common";

import { PlatformModule } from "../platform/platform.module";
import { LyricsController } from "./lyrics.controller";
import { LyricsService } from "./lyrics.service";

@Module({
  imports: [PlatformModule],
  controllers: [LyricsController],
  providers: [LyricsService],
})
export class LyricsModule {}
