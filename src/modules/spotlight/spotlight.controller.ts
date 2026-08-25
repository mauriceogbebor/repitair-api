import { Controller, Get, Param, Post } from "@nestjs/common";
import { SpotlightService } from "./spotlight.service";

@Controller("spotlight")
export class SpotlightController {
  constructor(private readonly spotlightService: SpotlightService) {}

  // ── Public routes (no auth required) ──

  /** GET /spotlight — active items for the mobile carousel */
  @Get()
  getActiveSpotlights() {
    return this.spotlightService.getActiveSpotlights();
  }

  /** POST /spotlight/:id/impression — track a view */
  @Post(":id/impression")
  trackImpression(@Param("id") id: string) {
    return this.spotlightService.trackImpression(id);
  }

  /** POST /spotlight/:id/tap — track an intentional campaign interaction */
  @Post(":id/tap")
  trackTap(@Param("id") id: string) {
    return this.spotlightService.trackTap(id);
  }
}
