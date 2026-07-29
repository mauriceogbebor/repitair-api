import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
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

  // Allowed MIME types for images (HEIC/HEIF for iOS camera uploads)
  private readonly ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
  ];

  // Maximum file size: 10MB
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;

  private readonly awsRegion: string;
  private baseUrl: string;

  constructor(private configService: ConfigService) {
    this.uploadProvider = (this.configService.get<string>("UPLOAD_PROVIDER") ||
      "local") as "local" | "s3";
    this.awsRegion = this.configService.get<string>("AWS_REGION") || "us-east-1";

    // ── Production safety: never silently use local storage ──
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";
    if (isProduction && this.uploadProvider === "local") {
      Logger.error(
        "UPLOAD_PROVIDER is 'local' in production! Uploaded files WILL BE LOST on restart/redeploy. " +
        "Set UPLOAD_PROVIDER=s3 with valid AWS credentials.",
        "UploadsService",
      );
      throw new Error(
        "Cannot start in production with UPLOAD_PROVIDER=local. " +
        "Set UPLOAD_PROVIDER=s3 and configure AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.",
      );
    } else if (this.uploadProvider === "local") {
      Logger.warn(
        "UPLOAD_PROVIDER=local — uploads will be stored on the local filesystem. " +
        "This is fine for development but MUST NOT be used in production.",
        "UploadsService",
      );
    }
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
      // Initialize S3 synchronously so upload requests cannot race the client setup.
      this.initS3();
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
  private initS3(): void {
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

  /** Reject anything that isn't a plain, server-issued object key (uuid + ext). */
  private assertSafeKey(key: string): string {
    const sanitized = path.basename(key);
    if (!key || sanitized !== key || key.includes("..") || key.includes("/") || key.includes("\\")) {
      throw new BadRequestException("Invalid storage key");
    }
    return sanitized;
  }

  /**
   * Read an already-stored object BY ITS SERVER-OWNED KEY. This is the only
   * supported way for the platform to read originals — it never fetches an
   * arbitrary/client-supplied URL, which eliminates the SSRF class entirely.
   * Throws NotFound when the object does not exist (upload-existence check).
   */
  async readFile(key: string): Promise<Buffer> {
    const safeKey = this.assertSafeKey(key);
    if (this.uploadProvider === "s3") {
      return this.readFromS3(safeKey);
    }
    const filepath = path.join(this.localUploadDir, safeKey);
    if (!fs.existsSync(filepath)) {
      throw new NotFoundException("Storage object not found");
    }
    return fs.promises.readFile(filepath);
  }

  /** Whether an object exists for this key (ownership/existence validation). */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.readFile(key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reconstruct the canonical URL for a server-owned key. Used so the backend
   * derives any URL it returns from a trusted key — never from client input.
   * (For private buckets this is where a short-lived signed URL is minted.)
   */
  urlForKey(key: string): string {
    const safeKey = this.assertSafeKey(key);
    if (this.uploadProvider === "s3") {
      return `https://${this.s3Bucket}.s3.${this.awsRegion}.amazonaws.com/${safeKey}`;
    }
    return `${this.baseUrl}/api/uploads/${safeKey}`;
  }

  private async readFromS3(key: string): Promise<Buffer> {
    if (!this.s3Client) throw new InternalServerErrorException("S3 client not initialized");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const s3Sdk = require("@aws-sdk/client-s3");
    try {
      const result = (await this.s3Client.send(new s3Sdk.GetObjectCommand({ Bucket: this.s3Bucket, Key: key }))) as {
        Body?: { transformToByteArray?: () => Promise<Uint8Array> };
      };
      const body = result.Body;
      if (!body?.transformToByteArray) throw new Error("empty S3 body");
      return Buffer.from(await body.transformToByteArray());
    } catch (error) {
      throw new NotFoundException(`Storage object not found: ${(error as Error).message}`);
    }
  }

  /**
   * Delete a file by its key
   */
  async deleteFile(key: string): Promise<void> {
    // Prevent path traversal — only allow simple filenames (uuid + extension)
    const sanitized = path.basename(key);
    if (sanitized !== key || key.includes("..")) {
      throw new BadRequestException("Invalid file key");
    }

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

    // Return S3 URL — include region to work outside us-east-1
    const url = `https://${this.s3Bucket}.s3.${this.awsRegion}.amazonaws.com/${filename}`;
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
      "image/heic": ".heic",
      "image/heif": ".heif",
    };

    return mimeTypeMap[mimetype] || ".jpg";
  }
}
