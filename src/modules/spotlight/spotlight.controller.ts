import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CreateSpotlightDto } from "./dto/create-spotlight.dto";
import { UpdateSpotlightDto } from "./dto/update-spotlight.dto";
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

  // ── Admin routes (auth required) ──
  // TODO: Add an admin role guard once you have role-based auth.
  // For now, any authenticated user can manage spotlights.

  /** GET /spotlight/admin/all — list all campaigns (any status) */
  @Get("admin/all")
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.spotlightService.findAll();
  }

  /** GET /spotlight/admin/:id — single campaign details */
  @Get("admin/:id")
  @UseGuards(JwtAuthGuard)
  findOne(@Param("id") id: string) {
    return this.spotlightService.findOne(id);
  }

  /** POST /spotlight/admin — create a new campaign */
  @Post("admin")
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateSpotlightDto) {
    return this.spotlightService.create(dto);
  }

  /** PATCH /spotlight/admin/:id — update a campaign */
  @Patch("admin/:id")
  @UseGuards(JwtAuthGuard)
  update(@Param("id") id: string, @Body() dto: UpdateSpotlightDto) {
    return this.spotlightService.update(id, dto);
  }

  /** DELETE /spotlight/admin/:id — remove a campaign */
  @Delete("admin/:id")
  @UseGuards(JwtAuthGuard)
  remove(@Param("id") id: string) {
    return this.spotlightService.remove(id);
  }
}
