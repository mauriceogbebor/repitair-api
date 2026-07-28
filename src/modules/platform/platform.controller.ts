import { Controller, Get } from "@nestjs/common";
import { PlatformService } from "./platform.service";

/**
 * Public platform configuration for the mobile app. No auth — the client must
 * be able to read minimum-version / maintenance / incident info before login.
 */
@Controller("platform")
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  /** GET /platform/config — operational config consumed by the mobile app. */
  @Get("config")
  getConfig() {
    return this.platformService.getPublicConfig();
  }
}
