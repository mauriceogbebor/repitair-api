import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { AdminRequest } from "../admin.types";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminSupportService } from "./admin-support.service";
import { AdminAddSupportTicketNoteDto } from "./dto/admin-add-support-ticket-note.dto";
import { AdminAssignSupportTicketDto } from "./dto/admin-assign-support-ticket.dto";
import { AdminClassifySupportTicketDto } from "./dto/admin-classify-support-ticket.dto";
import { AdminCreateSupportTicketDto } from "./dto/admin-create-support-ticket.dto";
import { AdminEscalateSupportTicketDto } from "./dto/admin-escalate-support-ticket.dto";
import { AdminListSupportTicketsQueryDto } from "./dto/admin-list-support-tickets-query.dto";
import { AdminReopenSupportTicketDto } from "./dto/admin-reopen-support-ticket.dto";
import { AdminResolveSupportTicketDto } from "./dto/admin-resolve-support-ticket.dto";
import { AdminRespondSupportTicketDto } from "./dto/admin-respond-support-ticket.dto";
import { AdminUpdateSupportEscalationDto } from "./dto/admin-update-support-escalation.dto";
import { AdminUpdateSupportTicketDto } from "./dto/admin-update-support-ticket.dto";
import { AdminUpdateSupportTicketPriorityDto } from "./dto/admin-update-support-ticket-priority.dto";
import { AdminUpdateSupportTicketStatusDto } from "./dto/admin-update-support-ticket-status.dto";

@Controller("admin/support/tickets")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminSupportController {
  constructor(private readonly adminSupportService: AdminSupportService) {}

  @Get()
  @AdminPermissions("support.cases.read")
  async listTickets(@Query() query: AdminListSupportTicketsQueryDto, @Req() req: AdminRequest) {
    return this.adminSupportService.listTickets(query, req.adminUser);
  }

  @Get("reviewers")
  @AdminPermissions("support.cases.assign")
  async listEligibleReviewers() {
    return this.adminSupportService.listEligibleReviewers();
  }

  @Get("export")
  @AdminPermissions("support.cases.export")
  async exportTickets(@Query() query: AdminListSupportTicketsQueryDto, @Req() req: AdminRequest, @Res() response: Response) {
    const result = await this.adminSupportService.exportTickets(query, req.adminUser, req.adminRequestContext);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    response.setHeader("X-Export-Result-Count", String(result.resultCount));
    response.setHeader("X-Export-Truncated", String(result.truncated));
    response.setHeader("X-Export-Limit", String(result.limit));
    response.send(result.csv);
  }

  @Get(":id")
  @AdminPermissions("support.cases.read")
  async getTicket(@Param("id") ticketId: string, @Req() req: AdminRequest) {
    return this.adminSupportService.getTicketDetail(ticketId, req.adminUser);
  }

  @Post()
  @AdminPermissions("support.cases.create")
  async createTicket(@Body() dto: AdminCreateSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.createTicket(dto, req.adminUser, req.adminRequestContext);
  }

  @Patch(":id")
  @AdminPermissions("support.cases.update")
  async updateTicket(@Param("id") ticketId: string, @Body() dto: AdminUpdateSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.updateTicket(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/classification")
  @AdminPermissions("support.cases.update")
  async classifyTicket(@Param("id") ticketId: string, @Body() dto: AdminClassifySupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.classifyTicket(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/assign")
  @AdminPermissions("support.cases.assign")
  async assignTicket(@Param("id") ticketId: string, @Body() dto: AdminAssignSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.assignTicket(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/status")
  @AdminPermissions("support.cases.update")
  async updateStatus(@Param("id") ticketId: string, @Body() dto: AdminUpdateSupportTicketStatusDto, @Req() req: AdminRequest) {
    return this.adminSupportService.updateStatus(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/priority")
  @AdminPermissions("support.cases.update")
  async updatePriority(@Param("id") ticketId: string, @Body() dto: AdminUpdateSupportTicketPriorityDto, @Req() req: AdminRequest) {
    return this.adminSupportService.updatePriority(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/notes")
  @AdminPermissions("support.cases.notes")
  async addNote(@Param("id") ticketId: string, @Body() dto: AdminAddSupportTicketNoteDto, @Req() req: AdminRequest) {
    return this.adminSupportService.addNote(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/responses")
  @AdminPermissions("support.cases.respond")
  async respond(@Param("id") ticketId: string, @Body() dto: AdminRespondSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.respond(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Get(":id/responses/:responseId/status")
  @AdminPermissions("support.cases.respond")
  async responseAttemptStatus(@Param("id") ticketId: string, @Param("responseId") responseId: string, @Req() req: AdminRequest) {
    return this.adminSupportService.getResponseAttemptStatus(ticketId, responseId, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/escalations")
  @AdminPermissions("support.cases.escalate")
  async escalate(@Param("id") ticketId: string, @Body() dto: AdminEscalateSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.escalate(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/escalations/:escalationId")
  @AdminPermissions("support.cases.escalate")
  async updateEscalation(
    @Param("id") ticketId: string,
    @Param("escalationId") escalationId: string,
    @Body() dto: AdminUpdateSupportEscalationDto,
    @Req() req: AdminRequest,
  ) {
    return this.adminSupportService.updateEscalation(ticketId, escalationId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/resolve")
  @AdminPermissions("support.cases.resolve")
  async resolveTicket(@Param("id") ticketId: string, @Body() dto: AdminResolveSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.resolveTicket(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/reopen")
  @AdminPermissions("support.cases.reopen")
  async reopenTicket(@Param("id") ticketId: string, @Body() dto: AdminReopenSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.reopenTicket(ticketId, dto, req.adminUser, req.adminRequestContext);
  }
}
