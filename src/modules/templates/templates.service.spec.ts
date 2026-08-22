import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";

import { TemplatesService } from "./templates.service";
import { Template } from "../../entities/template.entity";

describe("TemplatesService", () => {
  let service: TemplatesService;
  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    merge: jest.fn(),
    save: jest.fn(),
  };

  const validComposition = {
    version: 1 as const,
    templateId: "1",
    templateVersion: 2,
    canvasMeta: {
      width: 1000,
      height: 1778,
      aspectRatio: "9:16",
      coordinateSpace: "points" as const,
    },
    layers: [
      {
        id: "photo",
        name: "Photo",
        type: "photo",
        interactive: true,
        frame: {
          x: 0,
          y: 0,
          width: 1000,
          height: 1778,
          scale: 1,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
          locked: false,
          visible: true,
        },
        data: {},
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        { provide: getRepositoryToken(Template), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<TemplatesService>(TemplatesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("findAll", () => {
    it("should return templates sorted by sortOrder", async () => {
      const templates = [
        {
          id: "1",
          name: "Template A",
          sortOrder: 1,
          templateVersion: 2,
          composition: validComposition,
        },
        { id: "2", name: "Template B", sortOrder: 2 },
      ];
      mockRepo.find.mockResolvedValue(templates);

      const result = await service.findAll();

      expect(result[0]).toEqual(expect.objectContaining({
        id: "1",
        templateVersion: 2,
        composition: expect.objectContaining({
          templateId: "1",
          templateVersion: 2,
          canvasMeta: expect.objectContaining(validComposition.canvasMeta),
        }),
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        id: "2",
        templateVersion: 1,
        composition: null,
      }));
      expect(result[1].canvasMeta).toEqual(expect.objectContaining({
        width: 1000,
        height: 1778,
      }));
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { status: "published", isActive: true },
        order: { sortOrder: "ASC" },
      });
    });

    it("should return empty array when no templates exist", async () => {
      mockRepo.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });

    it("should query only published and active templates for the public listing", async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAll();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { status: "published", isActive: true },
        order: { sortOrder: "ASC" },
      });
    });

    it("should return every published Release 1 template without capability filtering", async () => {
      const ids = [
        "audioverse",
        "echo-room",
        "matcha-mood",
        "midnight-mood",
        "sonic-orbit",
        "soundscape",
        "air-wave",
        "ice-girl",
        "minion",
        "pink-replay",
      ];
      mockRepo.find.mockResolvedValue(ids.map((id, sortOrder) => ({
        id,
        name: id,
        sortOrder,
        status: "published",
        isActive: true,
        capabilities: id === "audioverse"
          ? { supportsIsolatedSubject: true, requiresBackgroundRemoval: true }
          : { supportsIsolatedSubject: false, requiresBackgroundRemoval: false },
      })));

      const result = await service.findAll();

      expect(result.map((template) => template.id)).toEqual(ids);
      expect(result).toHaveLength(10);
    });

    it("does not expose internal Admin identities or change summaries", async () => {
      mockRepo.find.mockResolvedValue([{
        id: "public-template",
        name: "Public template",
        status: "published",
        isActive: true,
        createdByAdminUserId: "9ba9197a-3f22-46cf-9c12-208158022907",
        createdByAdminEmail: "designer@repitair.com",
        updatedByAdminUserId: "e1cf5125-fe8c-49fc-b04d-a37605c5cb2f",
        updatedByAdminEmail: "reviewer@repitair.com",
        lastChangeSummary: "Internal release note",
      }]);

      const [result] = await service.findAll();

      expect(result).not.toHaveProperty("createdByAdminUserId");
      expect(result).not.toHaveProperty("createdByAdminEmail");
      expect(result).not.toHaveProperty("updatedByAdminUserId");
      expect(result).not.toHaveProperty("updatedByAdminEmail");
      expect(result).not.toHaveProperty("lastChangeSummary");
    });
  });
});
