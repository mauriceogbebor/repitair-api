import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { RepitsService } from "./repits.service";
import { Repit, Template } from "../../entities";
import { UploadsService } from "../uploads/uploads.service";
import { MediaProcessingService } from "../media/media-processing.service";
import { RepitPlatform } from "./dto/repit-presentation.dto";
import { CreateRepitDto } from "./dto/create-repit.dto";

describe("RepitsService", () => {
  let service: RepitsService;
  let repository: Repository<Repit>;

  const mockRepit = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId: "user_1",
    title: "Highest in the room",
    artist: "Travis Scott",
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    platform: "spotify",
    songLink: "https://open.spotify.com/track/example",
    status: "shared",
    templateId: "sunrise",
    templateVersion: 1,
    canvasMeta: null,
    composition: null,
    backgroundPhotoUrl: undefined,
    user: undefined,
  };

  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    merge: jest.fn(),
    delete: jest.fn(),
  };

  const mockTemplatesRepo = {
    findOne: jest.fn(),
  };

  const mockUploadsService = {
    deleteFile: jest.fn().mockResolvedValue(undefined),
    uploadFile: jest.fn(),
  };

  const mockMediaProcessingService = {
    assertRequiredIsolationReady: jest.fn().mockResolvedValue(null),
    linkRepit: jest.fn().mockResolvedValue({ linked: true }),
  };

  const validCanvasMeta = {
    width: 1000,
    height: 1778,
    aspectRatio: "9:16",
    coordinateSpace: "points" as const,
  };

  const validComposition = {
    version: 1 as const,
    templateId: "template_3",
    templateVersion: 4,
    canvasMeta: validCanvasMeta,
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
        RepitsService,
        {
          provide: getRepositoryToken(Repit),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Template),
          useValue: mockTemplatesRepo,
        },
        {
          provide: UploadsService,
          useValue: mockUploadsService,
        },
        {
          provide: MediaProcessingService,
          useValue: mockMediaProcessingService,
        },
      ],
    }).compile();

    service = module.get<RepitsService>(RepitsService);
    repository = module.get<Repository<Repit>>(getRepositoryToken(Repit));

    jest.clearAllMocks();
    mockTemplatesRepo.findOne.mockResolvedValue({
      id: "sunrise",
      status: "published",
      isActive: true,
      capabilities: {},
    });
    mockMediaProcessingService.assertRequiredIsolationReady.mockResolvedValue(null);
  });

  describe("listRepits", () => {
    it("should return paginated repits for given userId", async () => {
      mockRepository.findAndCount.mockResolvedValue([[mockRepit], 1]);

      const result = await service.listRepits("user_1");

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: expect.objectContaining({ userId: "user_1", moderationStatus: expect.any(Object) }),
        order: { createdAt: "DESC" },
        take: 50,
        skip: 0,
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(mockRepit);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it("should return empty data for userId with no repits", async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listRepits("user_2");

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe("getRepit", () => {
    it("should return old repits without composition safely", async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockRepit,
        composition: null,
        canvasMeta: null,
      });

      const result = await service.getRepit("user_1", mockRepit.id);

      expect(result).toEqual(expect.objectContaining({
        id: mockRepit.id,
        templateVersion: 1,
        composition: null,
        canvasMeta: null,
      }));
    });
  });

  describe("createRepit", () => {
    it("should create a new repit", async () => {
      const createDto: CreateRepitDto = {
        songTitle: "New Song",
        artistName: "New Artist",
        templateId: "template_1",
        songLink: "https://example.com/track",
        platform: RepitPlatform.SPOTIFY,
        backgroundPhotoUrl: "https://example.com/photo.jpg",
      };

      const newRepit = {
        ...mockRepit,
        title: createDto.songTitle,
        artist: createDto.artistName,
        songLink: createDto.songLink,
        backgroundPhotoUrl: createDto.backgroundPhotoUrl,
      };

      mockTemplatesRepo.findOne.mockResolvedValue({ id: "template_1" });
      mockRepository.create.mockReturnValue(newRepit);
      mockRepository.save.mockResolvedValue(newRepit);

      const result = await service.createRepit("user_1", createDto);

      expect(mockTemplatesRepo.findOne).toHaveBeenCalledWith({
        where: { id: "template_1", status: "published", isActive: true },
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_1",
          title: createDto.songTitle,
          artist: createDto.artistName,
          platform: "spotify",
          templateId: createDto.templateId,
          songLink: createDto.songLink,
          status: "draft",
          backgroundPhotoUrl: createDto.backgroundPhotoUrl,
        }),
      );
      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining(newRepit));
    });

    it("should use default values for optional fields", async () => {
      const createDto = {
        artistName: "Artist",
        templateId: "template_2",
        songLink: "https://example.com/track",
      };

      const newRepit = { ...mockRepit, title: "Untitled Repitair" };

      mockTemplatesRepo.findOne.mockResolvedValue({ id: "template_2" });
      mockRepository.create.mockReturnValue(newRepit);
      mockRepository.save.mockResolvedValue(newRepit);

      await service.createRepit("user_1", createDto);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Untitled Repitair",
          platform: "spotify",
          status: "draft",
          templateVersion: 1,
        })
      );
    });

    it("should persist canonical composition payload when provided", async () => {
      const createDto: CreateRepitDto = {
        templateId: "template_3",
        songTitle: "Blinding Lights",
        artistName: "The Weeknd",
        platform: RepitPlatform.SPOTIFY,
        templateVersion: 4,
        canvasMeta: validComposition.canvasMeta,
        composition: validComposition,
      };

      mockTemplatesRepo.findOne.mockResolvedValue({ id: "template_3" });
      mockRepository.create.mockReturnValue({ ...mockRepit, composition: validComposition, templateVersion: 4, canvasMeta: validComposition.canvasMeta });
      mockRepository.save.mockResolvedValue({ ...mockRepit, composition: validComposition, templateVersion: 4, canvasMeta: validComposition.canvasMeta });

      await service.createRepit("user_1", createDto);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          templateVersion: 4,
          canvasMeta: expect.objectContaining(validComposition.canvasMeta),
          composition: expect.objectContaining({
            templateId: "template_3",
            templateVersion: 4,
            canvasMeta: expect.objectContaining(validComposition.canvasMeta),
          }),
        }),
      );
    });

    it("should reject malformed composition payloads", async () => {
      mockTemplatesRepo.findOne.mockResolvedValue({ id: "template_3" });

      await expect(service.createRepit("user_1", {
        templateId: "template_3",
        composition: {
          version: 1,
          templateId: "other-template",
          layers: [],
        },
      })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("should enforce and link a completed isolation asset", async () => {
      const createDto: CreateRepitDto = {
        templateId: "audioverse",
        backgroundPhotoUrl: "https://media.example/subject.png",
        editorState: {
          mediaAssetId: "asset-1",
          processedPhotoUri: "https://media.example/subject.png",
        },
        composition: {
          ...validComposition,
          templateId: "audioverse",
          layers: [{
            ...validComposition.layers[0],
            data: { uri: "https://media.example/subject.png" },
          }],
        },
      };
      const saved = { ...mockRepit, id: "repit-audioverse", templateId: "audioverse" };
      mockTemplatesRepo.findOne.mockResolvedValue({
        id: "audioverse",
        status: "published",
        isActive: true,
        capabilities: { supportsIsolatedSubject: true, requiresBackgroundRemoval: true },
      });
      mockMediaProcessingService.assertRequiredIsolationReady.mockResolvedValue({
        assetId: "asset-1",
        derivativeUrl: "https://media.example/subject.png",
      });
      mockRepository.create.mockReturnValue(saved);
      mockRepository.save.mockResolvedValue(saved);

      await service.createRepit("user_1", createDto);

      expect(mockMediaProcessingService.assertRequiredIsolationReady).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_1", template: expect.objectContaining({ id: "audioverse" }) }),
      );
      expect(mockMediaProcessingService.linkRepit).toHaveBeenCalledWith(
        "asset-1",
        "repit-audioverse",
        "audioverse",
        "user_1",
      );
    });
  });

  describe("updateRepit", () => {
    it("should update existing repit", async () => {
      const updateDto = {
        title: "Updated Title",
        artist: "Updated Artist",
        status: "published",
      };

      const updatedRepit = { ...mockRepit, ...updateDto };

      mockRepository.findOne.mockResolvedValue(mockRepit);
      mockRepository.merge.mockReturnValue(updatedRepit);
      mockRepository.save.mockResolvedValue(updatedRepit);

      const result = await service.updateRepit("user_1", mockRepit.id, updateDto);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: mockRepit.id, userId: "user_1", moderationStatus: expect.any(Object) }),
      });
      expect(result).toEqual(expect.objectContaining(updatedRepit));
    });

    it("should preserve composition version when updating canonical payload", async () => {
      const updateDto = {
        templateVersion: 3,
        canvasMeta: { width: 1000, height: 1250, aspectRatio: "4:5", coordinateSpace: "points" },
        composition: {
          ...validComposition,
          templateId: "sunrise",
          templateVersion: 3,
          canvasMeta: { width: 1000, height: 1250, aspectRatio: "4:5", coordinateSpace: "points" as const },
        },
      };
      const updatedRepit = { ...mockRepit, ...updateDto };

      mockRepository.findOne.mockResolvedValue(mockRepit);
      mockRepository.merge.mockReturnValue(updatedRepit);
      mockRepository.save.mockResolvedValue(updatedRepit);

      const result = await service.updateRepit("user_1", mockRepit.id, updateDto);

      expect(repository.merge).toHaveBeenCalledWith(
        mockRepit,
        expect.objectContaining({
          templateVersion: 3,
          canvasMeta: expect.objectContaining(updateDto.canvasMeta),
          composition: expect.objectContaining({
            templateId: "sunrise",
            templateVersion: 3,
          }),
        }),
      );
      expect(result).toEqual(expect.objectContaining({
        id: updatedRepit.id,
        templateVersion: 3,
        canvasMeta: expect.objectContaining(updateDto.canvasMeta),
        composition: expect.objectContaining({
          templateId: "sunrise",
          templateVersion: 3,
        }),
      }));
    });

    it("should not save an Audioverse update that replaces the derivative with the original", async () => {
      const existing = {
        ...mockRepit,
        templateId: "audioverse",
        backgroundPhotoUrl: "https://media.example/subject.png",
        editorState: {
          mediaAssetId: "asset-1",
          processedPhotoUri: "https://media.example/subject.png",
        },
        composition: {
          ...validComposition,
          templateId: "audioverse",
          layers: [{
            ...validComposition.layers[0],
            data: { uri: "https://media.example/subject.png" },
          }],
        },
      };
      mockRepository.findOne.mockResolvedValue(existing);
      mockTemplatesRepo.findOne.mockResolvedValue({
        id: "audioverse",
        status: "published",
        isActive: true,
        capabilities: { supportsIsolatedSubject: true, requiresBackgroundRemoval: true },
      });
      mockMediaProcessingService.assertRequiredIsolationReady.mockRejectedValue(
        new BadRequestException("This template requires a completed isolated-subject image before the Repit can be saved."),
      );

      await expect(service.updateRepit("user_1", mockRepit.id, {
        backgroundPhotoUrl: "https://media.example/original.jpg",
      })).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it("should return null if repit not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.updateRepit("user_1", "nonexistent", {});

      expect(result).toBeNull();
    });

    it("should return null if userId does not match", async () => {
      // With the fix, findOne is scoped by userId — so a mismatched user
      // gets null from findOne directly.
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.updateRepit("user_2", mockRepit.id, {});

      expect(result).toBeNull();
    });
  });

  describe("deleteRepit", () => {
    it("should delete repit and return true", async () => {
      mockRepository.findOne.mockResolvedValue(mockRepit);
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deleteRepit("user_1", mockRepit.id);

      expect(repository.delete).toHaveBeenCalledWith({
        id: mockRepit.id,
        userId: "user_1",
      });
      expect(result).toBe(true);
    });

    it("should return false if repit not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.deleteRepit("user_1", "nonexistent");

      expect(result).toBe(false);
    });
  });
});
