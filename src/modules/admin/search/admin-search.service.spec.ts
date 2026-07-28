import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ContactSubmission, NotificationCampaign, Repit, Spotlight, Template, User } from "../../../entities";
import { AdminSearchService } from "./admin-search.service";

describe("AdminSearchService", () => {
  let service: AdminSearchService;

  const userRepository = { createQueryBuilder: jest.fn() };
  const repitRepository = { createQueryBuilder: jest.fn() };
  const templateRepository = { createQueryBuilder: jest.fn() };
  const spotlightRepository = { createQueryBuilder: jest.fn() };
  const supportTicketRepository = { createQueryBuilder: jest.fn() };
  const notificationRepository = { createQueryBuilder: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSearchService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Repit), useValue: repitRepository },
        { provide: getRepositoryToken(Template), useValue: templateRepository },
        { provide: getRepositoryToken(Spotlight), useValue: spotlightRepository },
        { provide: getRepositoryToken(ContactSubmission), useValue: supportTicketRepository },
        { provide: getRepositoryToken(NotificationCampaign), useValue: notificationRepository },
      ],
    }).compile();

    service = module.get(AdminSearchService);
  });

  it("returns grouped results only for permitted modules", async () => {
    const buildQb = (rows: unknown[]) => {
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      };
      return qb;
    };

    userRepository.createQueryBuilder.mockReturnValue(buildQb([{ id: "u1", fullName: "Maurice", email: "m@example.com", isSuspended: false }]));
    repitRepository.createQueryBuilder.mockReturnValue(buildQb([{ id: "r1", title: "Repit One", artist: "Artist", moderationStatus: "active" }]));

    const result = await service.search("rep", {
      id: "admin-1",
      email: "admin@example.com",
      fullName: "Admin",
      status: "active",
      roleKeys: ["support-admin"],
      permissionKeys: ["search.read", "users.read", "repits.read"],
    });

    expect(result.groups.map((group) => group.entityType)).toEqual(["users", "repits"]);
    expect(userRepository.createQueryBuilder.mock.results[0].value.where).toHaveBeenCalledWith(
      expect.stringContaining('CAST("user"."id" AS text)'),
      { search: "%rep%" },
    );
  });
});
