import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { AdminRequest } from "../admin.types";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import { AdminSessionService } from "./admin-session.service";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { AdminVerifyMfaDto } from "./dto/admin-verify-mfa.dto";

@Controller("admin/auth")
export class AdminAuthController {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly adminSessionService: AdminSessionService,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: AdminLoginDto, @Req() request: AdminRequest) {
    return this.adminAuthService.login(dto, request.adminRequestContext);
  }

  @Post("verify-mfa")
  @HttpCode(200)
  async verifyMfa(
    @Body() dto: AdminVerifyMfaDto,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adminAuthService.verifyMfa(dto, request.adminRequestContext);
    const csrfToken = this.adminSessionService.startSession(response, result.accessToken);
    return { status: result.status, admin: result.admin, csrfToken };
  }

  @Get("me")
  @UseGuards(AdminJwtAuthGuard)
  async me(@Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const csrfToken = this.adminSessionService.getOrCreateCsrfToken(
      request,
      response,
      request.adminSessionExpiresAt,
    );
    return {
      admin: await this.adminAuthService.getCurrentAdmin(request.adminUser!.id),
      csrfToken,
    };
  }

  @Post("logout")
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(200)
  async logout(@Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    try {
      await this.adminAuthService.logout(
        request.adminUser!,
        request.adminSessionToken!,
        request.adminSessionExpiresAt,
        request.adminRequestContext,
      );
      return { success: true };
    } finally {
      this.adminSessionService.clearSession(response);
    }
  }
}
