import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";

import { TemplatesService } from "./templates.service";
import { Template } from "../../entities/template.entity";

describe("TemplatesService", () => {
  let service: TemplatesService;
  const mockRepo = {
    find: jest.fn(),
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
        { id: "1", name: "Template A", sortOrder: 1 },
        { id: "2", name: "Template B", sortOrder: 2 },
      ];
      mockRepo.find.mockResolvedValue(templates);

      const result = await service.findAll();

      expect(result).toEqual(templates);
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
});
