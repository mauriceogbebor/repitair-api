import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { RepitsService } from "./repits.service";
import { Repit } from "../../entities";
import { UploadsService } from "../uploads/uploads.service";

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
    backgroundPhotoUrl: undefined,
    user: undefined,
  };

  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    merge: jest.fn(),
    delete: jest.fn(),
  };

  const mockUploadsService = {
    deleteFile: jest.fn().mockResolvedValue(undefined),
    uploadFile: jest.fn(),
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
          provide: UploadsService,
          useValue: mockUploadsService,
        },
      ],
    }).compile();

    service = module.get<RepitsService>(RepitsService);
    repository = module.get<Repository<Repit>>(getRepositoryToken(Repit));

    jest.clearAllMocks();
  });

  describe("listRepits", () => {
    it("should return repits for given userId", async () => {
      mockRepository.find.mockResolvedValue([mockRepit]);

      const result = await service.listRepits("user_1");

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: "user_1" },
        order: { createdAt: "DESC" },
        take: 50,
        skip: 0,
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockRepit);
    });

    it("should return empty array for userId with no repits", async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.listRepits("user_2");

      expect(result).toEqual([]);
    });
  });

  describe("createRepit", () => {
    it("should create a new repit", async () => {
      const createDto = {
        songTitle: "New Song",
        artistName: "New Artist",
        templateId: "template_1",
        songLink: "https://example.com/track",
        platform: "spotify",
        backgroundPhotoUrl: "https://example.com/photo.jpg",
      };

      const newRepit = {
        ...mockRepit,
        title: createDto.songTitle,
        artist: createDto.artistName,
        songLink: createDto.songLink,
        backgroundPhotoUrl: createDto.backgroundPhotoUrl,
      };

      mockRepository.create.mockReturnValue(newRepit);
      mockRepository.save.mockResolvedValue(newRepit);

      const result = await service.createRepit("user_1", createDto);

      expect(repository.create).toHaveBeenCalledWith({
        userId: "user_1",
        title: createDto.songTitle,
        artist: createDto.artistName,
        platform: "spotify",
        templateId: createDto.templateId,
        songLink: createDto.songLink,
        status: "draft",
        backgroundPhotoUrl: createDto.backgroundPhotoUrl,
      });
      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual(newRepit);
    });

    it("should use default values for optional fields", async () => {
      const createDto = {
        artistName: "Artist",
        templateId: "template_2",
        songLink: "https://example.com/track",
      };

      const newRepit = { ...mockRepit, title: "Untitled Repitair" };

      mockRepository.create.mockReturnValue(newRepit);
      mockRepository.save.mockResolvedValue(newRepit);

      await service.createRepit("user_1", createDto);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Untitled Repitair",
          platform: "spotify",
          status: "draft",
        })
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
        where: { id: mockRepit.id, userId: "user_1" },
      });
      expect(result).toEqual(updatedRepit);
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
