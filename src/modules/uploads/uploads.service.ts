import { BadRequestException, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { v4 as uuid } from "uuid";
import { UploadResponseDto } from "./dto/upload-response.dto";

// S3 types — only used when UPLOAD_PROVIDER=s3. The actual @aws-sdk/client-s3
// package is loaded dynamically at runtime so the build succeeds without it.
type S3ClientInstance = { send: (command: unknown) => Promise<unknown> };
type S3CommandCtor = new (input: Record<string, unknown>) => unknown;

/**
 * Detect the first non-internal IPv4 address so that upload URLs work on
 * physical devices connected to the same LAN — without requiring PUBLIC_URL.
 */
function detectLanIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

@Injectable()
export class UploadsService {
  private uploadProvider: "local" | "s3";
  private s3Client: S3ClientInstance | null = null;
  private s3Bucket: string;
  private PutObjectCommand: S3CommandCtor | null = null;
  private DeleteObjectCommand: S3CommandCtor | null = null;
  private localUploadDir: string;

  // Allowed MIME types for images
  private readonly ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ];

  // Maximum file size: 5MB
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024;

  private baseUrl: string;

  constructor(private configService: ConfigService) {
    this.uploadProvider = (this.configService.get<string>("UPLOAD_PROVIDER") ||
      "local") as "local" | "s3";
    this.s3Bucket = this.configService.get<string>("AWS_S3_BUCKET") || "";
    this.localUploadDir = path.join(process.cwd(), "data", "uploads");
    const port = this.configService.get<string>("PORT") || "4000";
    // Priority: explicit PUBLIC_URL > LAN IP auto-detect > localhost fallback.
    // PUBLIC_URL should always be set in production. LAN auto-detect covers the
    // common dev case of testing on a physical device over Wi-Fi.
    const explicitUrl = this.configService.get<string>("PUBLIC_URL");
    if (explicitUrl) {
      this.baseUrl = explicitUrl;
    } else {
      const lanIp = detectLanIp();
      if (lanIp) {
        this.baseUrl = `http://${lanIp}:${port}`;
        Logger.log(`PUBLIC_URL not set — using LAN IP: ${this.baseUrl}`, "UploadsService");
      } else {
        this.baseUrl = `http://localhost:${port}`;
        Logger.warn(
          "PUBLIC_URL not set and no LAN IP detected — upload URLs will use localhost (unreachable from devices)",
          "UploadsService",
        );
      }
    }

    if (this.uploadProvider === "s3") {
      // Lazy-init S3 so the build doesn't require @aws-sdk/client-s3
      this.initS3().catch((err) => {
        Logger.error(`Failed to initialise S3: ${err.message}`, "UploadsService");
        throw err;
      });
    } else {
      // Ensure local upload directory exists
      if (!fs.existsSync(this.localUploadDir)) {
        fs.mkdirSync(this.localUploadDir, { recursive: true });
      }
    }
  }

  /**
   * Dynamically import @aws-sdk/client-s3 so the package is only required
   * when UPLOAD_PROVIDER is explicitly set to 's3'.
   */
  private async initS3(): Promise<void> {
    const awsRegion = this.configService.get<string>("AWS_REGION");
    const awsAccessKeyId = this.configService.get<string>("AWS_ACCESS_KEY_ID");
    const awsSecretAccessKey = this.configService.get<string>("AWS_SECRET_ACCESS_KEY");

    if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey || !this.s3Bucket) {
      throw new Error(
        "AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET are required when UPLOAD_PROVIDER is 's3'",
      );
    }

    // Dynamic require so TypeScript doesn't try to resolve the module at compile time.
    // @aws-sdk/client-s3 must be installed (`npm i @aws-sdk/client-s3`) when using S3.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const s3Sdk = require("@aws-sdk/client-s3");
    this.PutObjectCommand = s3Sdk.PutObjectCommand;
    this.DeleteObjectCommand = s3Sdk.DeleteObjectCommand;
    this.s3Client = new s3Sdk.S3Client({
      region: awsRegion,
      credentials: { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey },
    }) as S3ClientInstance;
  }

  /**
   * Upload a file (image) to either local storage or S3
   */
  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<UploadResponseDto> {
    // Validate MIME type
    if (!this.ALLOWED_MIME_TYPES.includes(mimetype)) {
      throw new BadRequestException(
        `File type not allowed. Allowed types: ${this.ALLOWED_MIME_TYPES.join(", ")}`,
      );
    }

    // Validate file size
    if (buffer.length > this.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    // Generate unique filename
    const ext = this.getFileExtension(filename, mimetype);
    const uniqueFilename = `${uuid()}${ext}`;

    try {
      if (this.uploadProvider === "s3") {
        return await this.uploadToS3(buffer, uniqueFilename, mimetype);
      } else {
        return await this.uploadToLocal(buffer, uniqueFilename);
      }
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to upload file: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Delete a file by its key
   */
  async deleteFile(key: string): Promise<void> {
    try {
      if (this.uploadProvider === "s3") {
        await this.deleteFromS3(key);
      } else {
        await this.deleteFromLocal(key);
      }
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to delete file: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Upload to local storage
   */
  private async uploadToLocal(
    buffer: Buffer,
    filename: string,
  ): Promise<UploadResponseDto> {
    const filepath = path.join(this.localUploadDir, filename);
    fs.writeFileSync(filepath, buffer);

    // Return absolute URL so mobile clients can consume it directly
    const url = `${this.baseUrl}/api/uploads/${filename}`;
    return {
      url,
      key: filename,
    };
  }

  /**
   * Upload to S3
   */
  private async uploadToS3(
    buffer: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<UploadResponseDto> {
    if (!this.s3Client || !this.PutObjectCommand) {
      throw new Error("S3 client not initialized");
    }

    const command = new this.PutObjectCommand({
      Bucket: this.s3Bucket,
      Key: filename,
      Body: buffer,
      ContentType: mimetype,
    });

    await this.s3Client.send(command);

    // Return S3 URL
    const url = `https://${this.s3Bucket}.s3.amazonaws.com/${filename}`;
    return {
      url,
      key: filename,
    };
  }

  /**
   * Delete from local storage
   */
  private async deleteFromLocal(filename: string): Promise<void> {
    const filepath = path.join(this.localUploadDir, filename);

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }

  /**
   * Delete from S3
   */
  private async deleteFromS3(key: string): Promise<void> {
    if (!this.s3Client || !this.DeleteObjectCommand) {
      throw new Error("S3 client not initialized");
    }

    const command = new this.DeleteObjectCommand({
      Bucket: this.s3Bucket,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  /**
   * Extract file extension from filename or derive from mimetype
   */
  private getFileExtension(filename: string, mimetype: string): string {
    const ext = path.extname(filename);
    if (ext) {
      return ext;
    }

    // Fallback to MIME type mapping
    const mimeTypeMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
    };

    return mimeTypeMap[mimetype] || ".jpg";
  }
}
