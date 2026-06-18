import { BadRequestException, NotFoundException } from "@nestjs/common";
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
        order: { sortOrder: "ASC" },
      });
    });

    it("should return empty array when no templates exist", async () => {
      mockRepo.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe("updateComposition", () => {
    it("should update template composition with validated payload", async () => {
      const existing = {
        id: "1",
        name: "Template A",
        templateVersion: 1,
        canvasMeta: null,
        composition: null,
      };
      const merged = {
        ...existing,
        templateVersion: 2,
        canvasMeta: validComposition.canvasMeta,
        composition: validComposition,
      };

      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.merge.mockReturnValue(merged);
      mockRepo.save.mockResolvedValue(merged);

      const result = await service.updateComposition("1", {
        templateVersion: 2,
        canvasMeta: validComposition.canvasMeta,
        composition: validComposition,
      });

      expect(mockRepo.merge).toHaveBeenCalledWith(existing, expect.objectContaining({
        templateVersion: 2,
        composition: expect.objectContaining({
          templateId: "1",
          templateVersion: 2,
        }),
      }));
      expect(result).toEqual(expect.objectContaining({
        id: "1",
        composition: expect.objectContaining({
          templateId: "1",
        }),
      }));
    });

    it("should reject invalid composition payloads", async () => {
      mockRepo.findOne.mockResolvedValue({
        id: "1",
        name: "Template A",
        templateVersion: 1,
        canvasMeta: null,
        composition: null,
      });

      await expect(service.updateComposition("1", {
        composition: {
          version: 1,
          templateId: "other-template",
          layers: [],
        },
      })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("should throw when template is missing", async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.updateComposition("missing", {
        templateVersion: 1,
      })).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
