import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { MoreThan, Repository } from "typeorm";
import {
  AdminAuditLog,
  AdminRole,
  AdminUser,
  ContactSubmission,
  NotificationCampaign,
  Repit,
  Spotlight,
  Template,
  User,
} from "../../../entities";

@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminUserRepository: Repository<AdminUser>,
    @InjectRepository(AdminRole)
    private readonly adminRoleRepository: Repository<AdminRole>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Repit)
    private readonly repitRepository: Repository<Repit>,
    @InjectRepository(Template)
    private readonly templateRepository: Repository<Template>,
    @InjectRepository(Spotlight)
    private readonly spotlightRepository: Repository<Spotlight>,
    @InjectRepository(ContactSubmission)
    private readonly contactSubmissionRepository: Repository<ContactSubmission>,
    @InjectRepository(NotificationCampaign)
    private readonly notificationRepository: Repository<NotificationCampaign>,
  ) {}

  async getOverview() {
    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const nextSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [
      adminUsers,
      roles,
      audits,
      users,
      repits,
      templates,
      publishedTemplates,
      draftTemplates,
      spotlightCampaigns,
      activeSpotlights,
      expiringSpotlights,
      openTickets,
      assignedTickets,
      resolvedToday,
      scheduledNotifications,
      sentToday,
      failedNotifications,
    ] =
      await Promise.all([
        this.adminUserRepository.count(),
        this.adminRoleRepository.count(),
        this.auditLogRepository.count(),
        this.userRepository.count(),
        this.repitRepository.count(),
        this.templateRepository.count(),
        this.templateRepository.count({ where: { status: "published" } }),
        this.templateRepository.count({ where: { status: "draft" } }),
        this.spotlightRepository.count(),
        this.spotlightRepository.count({ where: { status: "active" } }),
        this.spotlightRepository.count({ where: { expiresAt: MoreThan(now), status: "active" } }),
        this.contactSubmissionRepository
          .createQueryBuilder("ticket")
          .where("ticket.status IN (:...statuses)", { statuses: ["new", "open", "assigned", "waiting_for_customer"] })
          .getCount(),
        this.contactSubmissionRepository.count({ where: { status: "assigned" } }),
        this.contactSubmissionRepository
          .createQueryBuilder("ticket")
          .where("ticket.resolvedAt >= :startOfToday", { startOfToday: startOfToday.toISOString() })
          .getCount(),
        this.notificationRepository.count({ where: { status: "scheduled" } }),
        this.notificationRepository
          .createQueryBuilder("notification")
          .where("notification.sentAt >= :startOfToday", { startOfToday: startOfToday.toISOString() })
          .getCount(),
        this.notificationRepository.count({ where: { status: "failed" } }),
      ]);

    const expiringSoon = await this.spotlightRepository
      .createQueryBuilder("spotlight")
      .where("spotlight.status = 'active'")
      .andWhere("spotlight.expiresAt IS NOT NULL")
      .andWhere("spotlight.expiresAt <= :nextSevenDays", { nextSevenDays: nextSevenDays.toISOString() })
      .getCount();

    return {
      generatedAt: new Date().toISOString(),
      cards: [
        { id: "templates", label: "Templates", value: templates, tone: "neutral", helper: "All template records across draft, published, and archived states." },
        { id: "templates-published", label: "Published Templates", value: publishedTemplates, tone: "positive", helper: "Templates currently available to the consumer experience." },
        { id: "templates-draft", label: "Draft Templates", value: draftTemplates, tone: "warning", helper: "Versioned templates waiting for review or publish." },
        { id: "spotlight-total", label: "Spotlight Campaigns", value: spotlightCampaigns, tone: "neutral", helper: "All spotlight campaigns managed from the admin back office." },
        { id: "spotlight-active", label: "Active Campaigns", value: activeSpotlights, tone: "positive", helper: "Campaigns currently eligible for the mobile spotlight carousel." },
        { id: "spotlight-expiring", label: "Expiring Campaigns", value: expiringSoon, tone: "warning", helper: "Active spotlight campaigns ending within the next seven days." },
        { id: "support-open", label: "Open Tickets", value: openTickets, tone: "warning", helper: "Support tickets that still need investigation or customer follow-up." },
        { id: "support-assigned", label: "Assigned Tickets", value: assignedTickets, tone: "neutral", helper: "Tickets currently owned by an operations team member." },
        { id: "support-resolved", label: "Resolved Today", value: resolvedToday, tone: "positive", helper: "Tickets marked resolved since midnight." },
        { id: "notifications-scheduled", label: "Scheduled Notifications", value: scheduledNotifications, tone: "neutral", helper: "Campaigns waiting for their scheduled send window." },
        { id: "notifications-sent", label: "Sent Today", value: sentToday, tone: "positive", helper: "Notification campaigns sent since midnight." },
        { id: "notifications-failed", label: "Failed Notifications", value: failedNotifications, tone: "danger", helper: "Campaigns that entered a failed state and need review." },
      ],
      health: [
        { id: "auth", label: "Admin Auth", status: "ready", detail: "Separate admin login and MFA verification endpoints are live." },
        { id: "rbac", label: "RBAC", status: "ready", detail: `${roles} pre-defined roles seeded from the PRD.` },
        { id: "audit", label: "Audit Logs", status: "ready", detail: `${audits} immutable admin write records captured so far.` },
        { id: "support", label: "Support Inbox", status: "ready", detail: `${openTickets} tickets are currently open across new, assigned, and waiting-for-customer states.` },
        { id: "notifications", label: "Notifications Console", status: "ready", detail: `${scheduledNotifications} campaigns are scheduled and ${failedNotifications} need delivery follow-up.` },
      ],
      nextUp: [
        `${adminUsers} admin users seeded across ${roles} roles`,
        `${users} consumer accounts and ${repits} repits currently visible to internal operations`,
        `${expiringSpotlights} spotlight campaigns require expiry review this week`,
        `${openTickets} support tickets and ${scheduledNotifications} scheduled notifications are waiting on the ops team`,
      ],
    };
  }
}
