import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import type { AdminRequest } from "../admin.types";
import { AdminIamService } from "./admin-iam.service";
import { AdminAcceptInvitationDto, AdminCompleteInvitationMfaDto } from "./dto/admin-accept-invitation.dto";

@Controller("admin/iam/invitations")
export class AdminInvitationAcceptanceController {
  constructor(private readonly iam: AdminIamService) {}

  @Get("accept")
  getInvitation(@Query("token") token: string) { return this.iam.getInvitation(this.requireToken(token)); }

  @Post("accept/password")
  @HttpCode(200)
  acceptPassword(@Query("token") token: string, @Body() dto: AdminAcceptInvitationDto, @Req() request: AdminRequest) { return this.iam.acceptInvitationPassword(this.requireToken(token), dto, request.adminRequestContext); }

  @Post("accept/mfa")
  @HttpCode(200)
  completeMfa(@Query("token") token: string, @Body() dto: AdminCompleteInvitationMfaDto, @Req() request: AdminRequest) { return this.iam.completeInvitationMfa(this.requireToken(token), dto, request.adminRequestContext); }

  private requireToken(token?: string) {
    if (!token || token.length < 32 || token.length > 200) throw new BadRequestException("A valid invitation token is required");
    return token;
  }
}
