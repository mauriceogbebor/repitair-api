import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { Repit } from "../../entities";
import { UploadsService } from "../uploads/uploads.service";
import { CreateRepitDto } from "./dto/create-repit.dto";
import { UpdateRepitDto } from "./dto/update-repit.dto";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export type ListRepitsOptions = {
  limit?: number;
  offset?: number;
};

@Injectable()
export class RepitsService {
  constructor(
    @InjectRepository(Repit)
    private readonly repitsRepo: Repository<Repit>,
    private readonly uploadsService: UploadsService,
  ) {}

  listRepits(userId: string, options: ListRepitsOptions = {}) {
    const take = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const skip = Math.max(options.offset ?? 0, 0);
    return this.repitsRepo.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take,
      skip,
    });
  }

  async createRepit(userId: string, body: CreateRepitDto) {
    const repit = this.repitsRepo.create({
      userId,
      title: body.songTitle ?? "Untitled Repitair",
      artist: body.artistName,
      platform: body.platform ?? "spotify",
      templateId: body.templateId,
      songLink: body.songLink ?? "",
      status: "draft",
      backgroundPhotoUrl: body.backgroundPhotoUrl,
    });

    return this.repitsRepo.save(repit);
  }

  async updateRepit(userId: string, id: string, body: UpdateRepitDto) {
    // Scope the find by userId so we don't leak existence of other users' repits.
    const existing = await this.repitsRepo.findOne({
      where: { id, userId },
    });

    if (!existing) {
      return null;
    }

    // If the photo is changing, schedule the old file for deletion.
    const oldPhoto = existing.backgroundPhotoUrl;
    const newPhoto = body.backgroundPhotoUrl;
    const photoChanged = newPhoto !== undefined && newPhoto !== oldPhoto;

    const updated = this.repitsRepo.merge(existing, {
      artist: body.artist ?? existing.artist,
      backgroundPhotoUrl: body.backgroundPhotoUrl ?? existing.backgroundPhotoUrl,
      status: body.status ?? existing.status,
      title: body.title ?? existing.title,
    });

    const saved = await this.repitsRepo.save(updated);

    if (photoChanged && oldPhoto) {
      // Fire-and-forget cleanup of the orphaned file. Failure here shouldn't
      // fail the update — the file will be caught by a periodic sweep instead.
      this.tryDeleteUpload(oldPhoto);
    }

    return saved;
  }

  async deleteRepit(userId: string, id: string): Promise<boolean> {
    // Fetch first so we can clean up the associated upload.
    const existing = await this.repitsRepo.findOne({
      where: { id, userId },
    });
    if (!existing) return false;

    const result = await this.repitsRepo.delete({ id, userId });
    const deleted = (result.affected ?? 0) > 0;

    if (deleted && existing.backgroundPhotoUrl) {
      this.tryDeleteUpload(existing.backgroundPhotoUrl);
    }

    return deleted;
  }

  /**
   * Best-effort deletion of an uploaded file given its public URL.
   * Extracts the storage key from the URL and calls the uploads service.
   */
  private tryDeleteUpload(url: string): void {
    try {
      // URLs look like https://host/api/uploads/<filename> (local) or
      // https://bucket.s3.amazonaws.com/<filename> (S3). Either way, the
      // last path segment is the key.
      const key = url.split("/").pop();
      if (!key) return;
      void this.uploadsService.deleteFile(key).catch(() => {
        // Swallow — sweep job will catch persistent orphans.
      });
    } catch {
      // URL parse error — ignore.
    }
  }
}
