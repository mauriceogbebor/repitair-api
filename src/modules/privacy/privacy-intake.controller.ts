import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { PrivacyWorkflowService } from "./privacy-workflow.service";
import { PrivacyQueryService } from "./privacy-query.service";
import type { PrivacyRequestType } from "../../entities/privacy-request.entity";

class SubmitPrivacyRequestDto {
  @IsIn(["data_access", "data_export", "data_correction", "account_deletion", "other"])
  type!: PrivacyRequestType;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

/**
 * Authenticated consumer intake for privacy requests (WS7). Users can only see
 * their own requests. Duplicate active requests of the same type are rejected
 * (409) by the workflow engine.
 */
@Controller("privacy")
@UseGuards(JwtAuthGuard)
export class PrivacyIntakeController {
  constructor(
    private readonly workflow: PrivacyWorkflowService,
    private readonly queries: PrivacyQueryService,
  ) {}

  @Post("request")
  async submit(@CurrentUser() user: CurrentUserPayload, @Body() dto: SubmitPrivacyRequestDto) {
    // No admin actor for self-service; the event actor falls back to the user's email.
    return this.workflow.createRequest(
      { userId: user.sub, userEmail: user.email, type: dto.type, notes: dto.notes ?? null },
      {},
    );
  }

  @Get("request/history")
  history(@CurrentUser() user: CurrentUserPayload) {
    return this.queries.listForUser(user.sub);
  }

  @Get("request/:id")
  get(@CurrentUser() user: CurrentUserPayload, @Param("id") id: string) {
    return this.queries.getForUser(user.sub, id);
  }
}
