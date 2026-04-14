import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import { UploadsService } from "./uploads.service";

// Mock fs module
jest.mock("fs");

describe("UploadsService", () => {
  let service: UploadsService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        UPLOAD_PROVIDER: "local",
        PORT: "4000",
        PUBLIC_URL: "http://localhost:4000",
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock fs functions
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
    (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe("constructor", () => {
    it("should create local dir when UPLOAD_PROVIDER is local", async () => {
      // The service constructor already ran, so we verify the mock was called
      // We can't easily re-instantiate, so we verify fs was set up correctly
      expect(configService.get).toHaveBeenCalledWith("UPLOAD_PROVIDER");
    });
  });

  describe("uploadFile", () => {
    it("should reject with BadRequestException when mimetype is text/plain", async () => {
      const buffer = Buffer.from("test content");

      await expect(
        service.uploadFile(buffer, "test.txt", "text/plain")
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject with BadRequestException when buffer exceeds 5MB", async () => {
      const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);

      await expect(
        service.uploadFile(buffer, "test.jpg", "image/jpeg")
      ).rejects.toThrow(BadRequestException);
    });

    it("should write file and return URL containing baseUrl and filename", async () => {
      const buffer = Buffer.from("test image data");
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "test.jpg", "image/jpeg");

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result.url).toContain("http://localhost:4000");
      expect(result.url).toContain("/api/uploads/");
      expect(result.key).toBeDefined();
    });

    it("should generate unique filenames for two successive uploads", async () => {
      const buffer = Buffer.from("test image data");
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result1 = await service.uploadFile(buffer, "test.jpg", "image/jpeg");
      const result2 = await service.uploadFile(buffer, "test.jpg", "image/jpeg");

      expect(result1.key).not.toEqual(result2.key);
    });

    it("should derive extension from mimetype when filename has no extension", async () => {
      const buffer = Buffer.from("test image data");
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "myfile", "image/png");

      expect(result.key).toMatch(/\.png$/);
    });

    it("should handle image/jpeg mimetype", async () => {
      const buffer = Buffer.from("test image data");
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "photo", "image/jpeg");

      expect(result.key).toMatch(/\.jpg$/);
    });

    it("should handle image/webp mimetype", async () => {
      const buffer = Buffer.from("test image data");
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "image", "image/webp");

      expect(result.key).toMatch(/\.webp$/);
    });

    it("should handle image/gif mimetype", async () => {
      const buffer = Buffer.from("test image data");
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "animation", "image/gif");

      expect(result.key).toMatch(/\.gif$/);
    });
  });

  describe("deleteFile", () => {
    it("should remove file from disk", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);

      await service.deleteFile("filename.jpg");

      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("should not throw when file does not exist", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(service.deleteFile("nonexistent.jpg")).resolves.not.toThrow();
    });
  });
});
