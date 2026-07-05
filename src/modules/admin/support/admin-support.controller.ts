import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AdminRequest } from "../admin.types";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminSupportService } from "./admin-support.service";
import { AdminAddSupportTicketNoteDto } from "./dto/admin-add-support-ticket-note.dto";
import { AdminAssignSupportTicketDto } from "./dto/admin-assign-support-ticket.dto";
import { AdminCreateSupportTicketDto } from "./dto/admin-create-support-ticket.dto";
import { AdminListSupportTicketsQueryDto } from "./dto/admin-list-support-tickets-query.dto";
import { AdminReopenSupportTicketDto } from "./dto/admin-reopen-support-ticket.dto";
import { AdminResolveSupportTicketDto } from "./dto/admin-resolve-support-ticket.dto";
import { AdminUpdateSupportTicketDto } from "./dto/admin-update-support-ticket.dto";
import { AdminUpdateSupportTicketPriorityDto } from "./dto/admin-update-support-ticket-priority.dto";
import { AdminUpdateSupportTicketStatusDto } from "./dto/admin-update-support-ticket-status.dto";

@Controller("admin/support/tickets")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminSupportController {
  constructor(private readonly adminSupportService: AdminSupportService) {}

  @Get()
  @AdminPermissions("support.read")
  async listTickets(@Query() query: AdminListSupportTicketsQueryDto) {
    return this.adminSupportService.listTickets(query);
  }

  @Get(":id")
  @AdminPermissions("support.read")
  async getTicket(@Param("id") ticketId: string) {
    return this.adminSupportService.getTicketDetail(ticketId);
  }

  @Post()
  @AdminPermissions("support.write")
  async createTicket(@Body() dto: AdminCreateSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.createTicket(dto, req.adminUser, req.adminRequestContext);
  }

  @Patch(":id")
  @AdminPermissions("support.write")
  async updateTicket(@Param("id") ticketId: string, @Body() dto: AdminUpdateSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.updateTicket(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/assign")
  @AdminPermissions("support.assign")
  async assignTicket(@Param("id") ticketId: string, @Body() dto: AdminAssignSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.assignTicket(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/status")
  @AdminPermissions("support.write")
  async updateStatus(@Param("id") ticketId: string, @Body() dto: AdminUpdateSupportTicketStatusDto, @Req() req: AdminRequest) {
    return this.adminSupportService.updateStatus(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/priority")
  @AdminPermissions("support.write")
  async updatePriority(@Param("id") ticketId: string, @Body() dto: AdminUpdateSupportTicketPriorityDto, @Req() req: AdminRequest) {
    return this.adminSupportService.updatePriority(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/notes")
  @AdminPermissions("support.write")
  async addNote(@Param("id") ticketId: string, @Body() dto: AdminAddSupportTicketNoteDto, @Req() req: AdminRequest) {
    return this.adminSupportService.addNote(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/resolve")
  @AdminPermissions("support.resolve")
  async resolveTicket(@Param("id") ticketId: string, @Body() dto: AdminResolveSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.resolveTicket(ticketId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/reopen")
  @AdminPermissions("support.resolve")
  async reopenTicket(@Param("id") ticketId: string, @Body() dto: AdminReopenSupportTicketDto, @Req() req: AdminRequest) {
    return this.adminSupportService.reopenTicket(ticketId, dto, req.adminUser, req.adminRequestContext);
  }
}
