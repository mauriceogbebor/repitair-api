import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { AdminRequest } from "../admin.types";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { AdminVerifyMfaDto } from "./dto/admin-verify-mfa.dto";

@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: AdminLoginDto, @Req() request: AdminRequest) {
    return this.adminAuthService.login(dto, request.adminRequestContext);
  }

  @Post("verify-mfa")
  @HttpCode(200)
  async verifyMfa(@Body() dto: AdminVerifyMfaDto, @Req() request: AdminRequest) {
    return this.adminAuthService.verifyMfa(dto, request.adminRequestContext);
  }

  @Get("me")
  @UseGuards(AdminJwtAuthGuard)
  async me(@Req() request: AdminRequest) {
    return this.adminAuthService.getCurrentAdmin(request.adminUser!.id);
  }

  @Post("logout")
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(200)
  async logout(@Req() request: AdminRequest) {
    return this.adminAuthService.logout(request.adminUser!, request.adminRequestContext);
  }
}
