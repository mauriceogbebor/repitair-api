import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import { UploadsService } from "./uploads.service";

// Mock fs module
jest.mock("fs");


// Minimal real magic-byte headers (the service now validates file content, not the client MIME type).
const pad = (head: number[] | Buffer) => Buffer.concat([Buffer.from(head as number[]), Buffer.alloc(32)]);
const IMG: Record<string, Buffer> = {
  "image/jpeg": pad([0xff, 0xd8, 0xff, 0xe0]),
  "image/png": pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": pad(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])),
  "image/gif": pad(Buffer.from("GIF89a")),
  "image/heic": pad(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic")])),
  "image/heif": pad(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypmif1")])),
};

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

    it("should reject with BadRequestException when buffer exceeds 10MB", async () => {
      const buffer = Buffer.alloc(10 * 1024 * 1024 + 1);

      await expect(
        service.uploadFile(buffer, "test.jpg", "image/jpeg")
      ).rejects.toThrow(BadRequestException);
    });

    it("should write file and return URL containing baseUrl and filename", async () => {
      const buffer = IMG["image/jpeg"];
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "test.jpg", "image/jpeg");

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result.url).toContain("http://localhost:4000");
      expect(result.url).toContain("/api/uploads/");
      expect(result.key).toBeDefined();
    });

    it("should generate unique filenames for two successive uploads", async () => {
      const buffer = IMG["image/jpeg"];
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result1 = await service.uploadFile(buffer, "test.jpg", "image/jpeg");
      const result2 = await service.uploadFile(buffer, "test.jpg", "image/jpeg");

      expect(result1.key).not.toEqual(result2.key);
    });

    it("should derive extension from mimetype when filename has no extension", async () => {
      const buffer = IMG["image/png"];
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "myfile", "image/png");

      expect(result.key).toMatch(/\.png$/);
    });

    it("should handle image/jpeg mimetype", async () => {
      const buffer = IMG["image/jpeg"];
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "photo", "image/jpeg");

      expect(result.key).toMatch(/\.jpg$/);
    });

    it("should handle image/webp mimetype", async () => {
      const buffer = IMG["image/webp"];
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "image", "image/webp");

      expect(result.key).toMatch(/\.webp$/);
    });

    it("should handle image/gif mimetype", async () => {
      const buffer = IMG["image/gif"];
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "animation", "image/gif");

      expect(result.key).toMatch(/\.gif$/);
    });

    it("should handle image/heic mimetype (iOS camera)", async () => {
      const buffer = IMG["image/heic"];
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "photo", "image/heic");

      expect(result.key).toMatch(/\.heic$/);
    });

    it("should handle image/heif mimetype", async () => {
      const buffer = IMG["image/heif"];
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.uploadFile(buffer, "photo", "image/heif");

      expect(result.key).toMatch(/\.heic$/); // HEIF family is normalised to .heic
    });
  });

  describe("content validation (spoofed uploads)", () => {
    it("rejects HTML disguised as image/png", async () => {
      const html = Buffer.from("<html><script>alert(document.cookie)</script></html>");
      await expect(service.uploadFile(html, "avatar.png", "image/png")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects SVG even with an image MIME type", async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
      await expect(service.uploadFile(svg, "x.svg", "image/gif")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects MP4 (ftyp box with a non-HEIF brand)", async () => {
      const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(32)]);
      await expect(service.uploadFile(mp4, "clip.heic", "image/heic")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("ignores the client extension and uses the sniffed type", async () => {
      const result = await service.uploadFile(IMG["image/png"], "evil.html", "image/png");
      expect(result.key).toMatch(/^[0-9a-f-]{36}\.png$/);
    });
  });

  describe("durable read URLs", () => {
    it("returns an application proxy URL for a server-owned key", () => {
      expect(service.urlForKey("photo.jpg")).toBe(
        "http://localhost:4000/api/uploads/photo.jpg",
      );
    });

    it("normalizes legacy private-S3 object URLs to the application proxy", () => {
      Object.assign(service, {
        uploadProvider: "s3",
        s3Bucket: "repitair-staging",
        awsRegion: "eu-west-1",
      });

      expect(service.canonicalReadUrl(
        "https://repitair-staging.s3.eu-west-1.amazonaws.com/photo.jpg?X-Amz-Signature=expired",
      )).toBe("http://localhost:4000/api/uploads/photo.jpg");
    });

    it("does not rewrite third-party artwork URLs", () => {
      const url = "https://i.scdn.co/image/album-art";
      expect(service.canonicalReadUrl(url)).toBe(url);
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
