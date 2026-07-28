import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ContactSubmission, NotificationCampaign, Repit, Spotlight, Template, User } from "../../../entities";
import type { AdminRequestActor } from "../admin.types";

@Injectable()
export class AdminSearchService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Repit)
    private readonly repitRepository: Repository<Repit>,
    @InjectRepository(Template)
    private readonly templateRepository: Repository<Template>,
    @InjectRepository(Spotlight)
    private readonly spotlightRepository: Repository<Spotlight>,
    @InjectRepository(ContactSubmission)
    private readonly supportTicketRepository: Repository<ContactSubmission>,
    @InjectRepository(NotificationCampaign)
    private readonly notificationRepository: Repository<NotificationCampaign>,
  ) {}

  async search(query: string, actor: AdminRequestActor) {
    const q = query.trim();
    if (!q) {
      return { query: q, groups: [] };
    }

    const permissions = new Set(actor.permissionKeys);
    const groups: Array<{ entityType: string; label: string; results: Array<Record<string, unknown>> }> = [];

    if (permissions.has("users.read")) {
      const users = await this.userRepository
        .createQueryBuilder("user")
        .select(["user.id", "user.fullName", "user.email", "user.isSuspended"])
        .where("CAST(\"user\".\"id\" AS text) ILIKE :search OR user.email ILIKE :search OR user.fullName ILIKE :search", {
          search: `%${q}%`,
        })
        .orderBy("user.createdAt", "DESC")
        .limit(5)
        .getMany();

      groups.push({
        entityType: "users",
        label: "Users",
        results: users.map((user) => ({
          id: user.id,
          title: user.fullName,
          subtitle: user.email,
          status: user.isSuspended ? "suspended" : "active",
          href: `/users/${user.id}`,
        })),
      });
    }

    if (permissions.has("repits.read")) {
      const repits = await this.repitRepository
        .createQueryBuilder("repit")
        .leftJoinAndSelect("repit.user", "user")
        .leftJoinAndSelect("repit.template", "template")
        .where(
          "repit.id::text ILIKE :search OR repit.title ILIKE :search OR COALESCE(repit.artist, '') ILIKE :search OR user.fullName ILIKE :search OR user.email ILIKE :search OR template.name ILIKE :search",
          { search: `%${q}%` },
        )
        .orderBy("repit.createdAt", "DESC")
        .limit(5)
        .getMany();

      groups.push({
        entityType: "repits",
        label: "Repits",
        results: repits.map((repit) => ({
          id: repit.id,
          title: repit.title,
          subtitle: repit.artist ?? repit.user?.fullName ?? "Repit",
          status: repit.moderationStatus,
          href: `/repits/${repit.id}`,
        })),
      });
    }

    if (permissions.has("templates.read")) {
      const templates = await this.templateRepository
        .createQueryBuilder("template")
        .where("template.id ILIKE :search OR template.name ILIKE :search OR template.style ILIKE :search", {
          search: `%${q}%`,
        })
        .orderBy("template.sortOrder", "ASC")
        .limit(5)
        .getMany();

      groups.push({
        entityType: "templates",
        label: "Templates",
        results: templates.map((template) => ({
          id: template.id,
          title: template.name,
          subtitle: `${template.style} · ${template.category}`,
          status: template.status,
          href: `/templates/${template.id}`,
        })),
      });
    }

    if (permissions.has("spotlight.read")) {
      const spotlights = await this.spotlightRepository
        .createQueryBuilder("spotlight")
        .where(
          "spotlight.title ILIKE :search OR COALESCE(spotlight.subtitle, '') ILIKE :search OR spotlight.artist ILIKE :search OR COALESCE(spotlight.submitterEmail, '') ILIKE :search",
          { search: `%${q}%` },
        )
        .orderBy("spotlight.updatedAt", "DESC")
        .limit(5)
        .getMany();

      groups.push({
        entityType: "spotlight",
        label: "Spotlight Campaigns",
        results: spotlights.map((spotlight) => ({
          id: spotlight.id,
          title: spotlight.title,
          subtitle: spotlight.artist,
          status: spotlight.status,
          href: `/spotlight/${spotlight.id}`,
        })),
      });
    }

    if (permissions.has("support.read")) {
      const tickets = await this.supportTicketRepository
        .createQueryBuilder("ticket")
        .where(
          "ticket.id::text ILIKE :search OR ticket.subject ILIKE :search OR ticket.message ILIKE :search OR ticket.name ILIKE :search OR ticket.email ILIKE :search",
          { search: `%${q}%` },
        )
        .orderBy("ticket.updatedAt", "DESC")
        .limit(5)
        .getMany();

      groups.push({
        entityType: "support",
        label: "Support Tickets",
        results: tickets.map((ticket) => ({
          id: ticket.id,
          title: ticket.subject,
          subtitle: `${ticket.name} · ${ticket.email}`,
          status: ticket.status,
          href: `/support/${ticket.id}`,
        })),
      });
    }

    if (permissions.has("notifications.read")) {
      const notifications = await this.notificationRepository
        .createQueryBuilder("notification")
        .where("notification.title ILIKE :search OR notification.message ILIKE :search", {
          search: `%${q}%`,
        })
        .orderBy("notification.updatedAt", "DESC")
        .limit(5)
        .getMany();

      groups.push({
        entityType: "notifications",
        label: "Notifications",
        results: notifications.map((notification) => ({
          id: notification.id,
          title: notification.title,
          subtitle: notification.audience,
          status: notification.status,
          href: `/notifications/${notification.id}`,
        })),
      });
    }

    return {
      query: q,
      groups,
    };
  }
}
