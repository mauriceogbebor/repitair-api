import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { MusicModule } from "./modules/music/music.module";
import { RepitsModule } from "./modules/repits/repits.module";
import { TemplatesModule } from "./modules/templates/templates.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    MusicModule,
    TemplatesModule,
    RepitsModule
  ]
})
export class AppModule {}
