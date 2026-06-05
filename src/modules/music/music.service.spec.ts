import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";

import { MusicService } from "./music.service";
import { User } from "../../entities";

describe("MusicService", () => {
  let service: MusicService;
  const mockUsersRepo = {
    createQueryBuilder: jest.fn(() => ({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    })),
    update: jest.fn(),
  };
  const mockConfig = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        SPOTIFY_CLIENT_ID: "test-client-id",
        SPOTIFY_CLIENT_SECRET: "test-client-secret",
        REDIS_URL: "",
      };
      return config[key] ?? undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MusicService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
      ],
    }).compile();

    service = module.get<MusicService>(MusicService);
  });

  describe("detectLinkType", () => {
    it("should detect Spotify track links", () => {
      expect(service.detectLinkType("https://open.spotify.com/track/abc123")).toBe("track");
    });

    it("should detect Spotify album links", () => {
      expect(service.detectLinkType("https://open.spotify.com/album/abc123")).toBe("album");
    });

    it("should detect Spotify playlist links", () => {
      expect(service.detectLinkType("https://open.spotify.com/playlist/abc123")).toBe("playlist");
    });

    it("should detect Apple Music album links", () => {
      expect(service.detectLinkType("https://music.apple.com/us/album/test/12345")).toBe("album");
    });

    it("should detect Apple Music track links (with ?i=)", () => {
      expect(service.detectLinkType("https://music.apple.com/us/album/test/12345?i=67890")).toBe("track");
    });
  });

  describe("parseLink", () => {
    it("should reject non-music links", async () => {
      await expect(service.parseLink("https://example.com")).rejects.toThrow(BadRequestException);
    });
  });

  describe("getRecentSongs", () => {
    it("should return empty array without userId", async () => {
      const result = await service.getRecentSongs();
      expect(result).toEqual([]);
    });
  });

  describe("search", () => {
    it("should return empty array for empty query", async () => {
      const result = await service.search("");
      expect(result).toEqual([]);
    });

    it("should return empty array for empty Apple Music query", async () => {
      const result = await service.search("", "apple-music");
      expect(result).toEqual([]);
    });
  });
});
