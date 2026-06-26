import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";

import { Repit, Template } from "../../entities";
import {
  assertCanvasMeta,
  assertRepitComposition,
  DEFAULT_CANVAS_META,
  normalizeCanvasMeta,
  normalizeRepitState,
} from "../../common/composition/composition.utils";
import type { CompositionCanvasMeta, RepitComposition } from "../../common/composition/composition.types";
import { UploadsService } from "../uploads/uploads.service";
import { CreateRepitDto } from "./dto/create-repit.dto";
import { UpdateRepitDto } from "./dto/update-repit.dto";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const LEGACY_MISSING_REPIT_COLUMNS = [
  "albumArt",
  "durationMs",
  "updatedAt",
  "selectedSongs",
  "widgetTransforms",
  "editorState",
  "templateVersion",
  "canvasMeta",
  "composition",
];

function resolveTemplateVersion(value: unknown, fallback = 1): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveCanvasMeta(
  explicitMeta: CompositionCanvasMeta | null | undefined,
  composition: RepitComposition | null | undefined,
): CompositionCanvasMeta | null {
  if (explicitMeta && typeof explicitMeta === "object") {
    return explicitMeta;
  }

  const compositionMeta = composition?.canvasMeta ?? null;

  return compositionMeta && typeof compositionMeta === "object" ? compositionMeta : null;
}

function resolveTemplateVersionFromComposition(
  explicitVersion: number | null | undefined,
  composition: { templateVersion?: unknown } | null | undefined,
): number {
  if (typeof explicitVersion === "number" && Number.isFinite(explicitVersion)) {
    return explicitVersion;
  }

  const compositionVersion = composition && typeof composition === "object"
    ? (composition as { templateVersion?: unknown }).templateVersion
    : undefined;

  return resolveTemplateVersion(compositionVersion, 1);
}

function isLegacyRepitSchemaError(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) {
    return false;
  }

  const message = String((err as QueryFailedError & { message?: string }).message ?? "");
  return LEGACY_MISSING_REPIT_COLUMNS.some((column) => message.includes(column));
}

export type ListRepitsOptions = {
  limit?: number;
  offset?: number;
};

@Injectable()
export class RepitsService {
  constructor(
    @InjectRepository(Repit)
    private readonly repitsRepo: Repository<Repit>,
    @InjectRepository(Template)
    private readonly templatesRepo: Repository<Template>,
    private readonly uploadsService: UploadsService,
  ) {}

  async getRepit(userId: string, id: string): Promise<Repit | null> {
    try {
      const repit = await this.repitsRepo.findOne({ where: { id, userId } });
      return repit ? this.normalizeRepit(repit) : null;
    } catch (err) {
      if (isLegacyRepitSchemaError(err)) {
        return this.getRepitLegacy(userId, id);
      }
      throw err;
    }
  }

  async listRepits(userId: string, options: ListRepitsOptions = {}) {
    const take = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const skip = Math.max(options.offset ?? 0, 0);
    try {
      const [data, total] = await this.repitsRepo.findAndCount({
        where: { userId },
        order: { createdAt: "DESC" },
        take,
        skip,
      });
      return {
        data: data.map((repit) => this.normalizeRepit(repit)),
        total,
        limit: take,
        offset: skip,
      };
    } catch (err) {
      if (isLegacyRepitSchemaError(err)) {
        return this.listRepitsLegacy(userId, take, skip);
      }
      throw err;
    }
  }

  async createRepit(userId: string, body: CreateRepitDto) {
    // Validate templateId exists
    const template = await this.templatesRepo.findOne({ where: { id: body.templateId } });
    if (!template) {
      throw new BadRequestException(`Template "${body.templateId}" does not exist`);
    }

    const fallbackCanvasMeta = normalizeCanvasMeta(template.canvasMeta, DEFAULT_CANVAS_META);
    const validatedCanvasMeta = body.canvasMeta !== undefined
      ? assertCanvasMeta(body.canvasMeta, "canvasMeta")
      : null;
    const validatedComposition = body.composition !== undefined
      ? assertRepitComposition(body.composition, {
        context: "composition",
        templateId: body.templateId,
        templateVersion: body.templateVersion ?? template.templateVersion,
        fallbackCanvasMeta: validatedCanvasMeta ?? fallbackCanvasMeta,
      })
      : null;

    const repit = this.repitsRepo.create({
      userId,
      title: body.songTitle ?? "Untitled Repitair",
      artist: body.artistName,
      platform: body.platform ?? "spotify",
      templateId: body.templateId,
      songLink: body.songLink ?? "",
      albumArt: body.albumArt,
      durationMs: body.durationMs,
      status: "draft",
      backgroundPhotoUrl: body.backgroundPhotoUrl,
      selectedSongs: body.selectedSongs ?? this.buildFallbackSelectedSongs(body),
      widgetTransforms: body.widgetTransforms ?? null,
      editorState: body.editorState ?? null,
      templateVersion: resolveTemplateVersionFromComposition(body.templateVersion, validatedComposition),
      canvasMeta: resolveCanvasMeta(validatedCanvasMeta, validatedComposition),
      composition: validatedComposition,
    });

    try {
      const saved = await this.repitsRepo.save(repit);
      return this.normalizeRepit(saved);
    } catch (err) {
      if (isLegacyRepitSchemaError(err)) {
        return this.createRepitLegacy(userId, body);
      }
      throw err;
    }
  }

  async updateRepit(userId: string, id: string, body: UpdateRepitDto) {
    if (body.templateId) {
      const template = await this.templatesRepo.findOne({ where: { id: body.templateId } });
      if (!template) {
        throw new BadRequestException(`Template "${body.templateId}" does not exist`);
      }
    }

    let existing: Repit | null;
    try {
      // Scope the find by userId so we don't leak existence of other users' repits.
      existing = await this.repitsRepo.findOne({
        where: { id, userId },
      });
    } catch (err) {
      if (isLegacyRepitSchemaError(err)) {
        return this.updateRepitLegacy(userId, id, body);
      }
      throw err;
    }

    if (!existing) {
      return null;
    }

    const effectiveTemplateId = body.templateId ?? existing.templateId;
    const validatedCanvasMeta = body.canvasMeta !== undefined
      ? assertCanvasMeta(body.canvasMeta, "canvasMeta")
      : undefined;
    const validatedComposition = body.composition !== undefined
      ? assertRepitComposition(body.composition, {
        context: "composition",
        templateId: effectiveTemplateId,
        templateVersion: body.templateVersion ?? existing.templateVersion ?? null,
        fallbackCanvasMeta: validatedCanvasMeta ?? normalizeCanvasMeta(existing.canvasMeta, DEFAULT_CANVAS_META),
      })
      : undefined;

    // If the photo is changing, schedule the old file for deletion.
    const oldPhoto = existing.backgroundPhotoUrl;
    const newPhoto = body.backgroundPhotoUrl;
    const photoChanged = newPhoto !== undefined && newPhoto !== oldPhoto;

    const updated = this.repitsRepo.merge(existing, {
      artist: body.artist ?? existing.artist,
      albumArt: body.albumArt !== undefined ? body.albumArt ?? null : existing.albumArt,
      backgroundPhotoUrl: body.backgroundPhotoUrl !== undefined
        ? body.backgroundPhotoUrl ?? null
        : existing.backgroundPhotoUrl,
      durationMs: body.durationMs !== undefined ? body.durationMs ?? null : existing.durationMs,
      platform: body.platform ?? existing.platform,
      selectedSongs: body.selectedSongs ?? existing.selectedSongs,
      songLink: body.songLink !== undefined ? body.songLink ?? "" : existing.songLink,
      status: body.status ?? existing.status,
      templateId: body.templateId ?? existing.templateId,
      templateVersion: body.templateVersion !== undefined
        ? resolveTemplateVersionFromComposition(body.templateVersion, validatedComposition)
        : existing.templateVersion,
      title: body.title ?? existing.title,
      widgetTransforms: body.widgetTransforms ?? existing.widgetTransforms,
      editorState: body.editorState ?? existing.editorState,
      canvasMeta: validatedCanvasMeta !== undefined || validatedComposition !== undefined
        ? resolveCanvasMeta(validatedCanvasMeta, validatedComposition)
        : existing.canvasMeta,
      composition: validatedComposition !== undefined ? validatedComposition : existing.composition,
    });

    let saved: Repit;
    try {
      saved = await this.repitsRepo.save(updated);
    } catch (err) {
      if (isLegacyRepitSchemaError(err)) {
        return this.updateRepitLegacy(userId, id, body);
      }
      throw err;
    }

    if (photoChanged && oldPhoto) {
      // Fire-and-forget cleanup of the orphaned file. Failure here shouldn't
      // fail the update — the file will be caught by a periodic sweep instead.
      this.tryDeleteUpload(oldPhoto);
    }

    return this.normalizeRepit(saved);
  }

  async deleteRepit(userId: string, id: string): Promise<boolean> {
    // Fetch first so we can clean up the associated uploads.
    let existing: Repit | null;
    try {
      existing = await this.repitsRepo.findOne({
        where: { id, userId },
      });
    } catch (err) {
      if (isLegacyRepitSchemaError(err)) {
        existing = await this.getRepitLegacy(userId, id);
      } else {
        throw err;
      }
    }
    if (!existing) return false;

    const result = await this.repitsRepo.delete({ id, userId });
    const deleted = (result.affected ?? 0) > 0;

    if (deleted) {
      // Best-effort cleanup of all uploaded assets associated with this repit.
      // Failures are silently swallowed — orphans are caught by periodic sweep.
      if (existing.backgroundPhotoUrl) {
        this.tryDeleteUpload(existing.backgroundPhotoUrl);
      }
      // Clean up images embedded in composition layers (photo layers, etc.)
      this.tryDeleteCompositionAssets(existing.composition);
    }

    return deleted;
  }

  /**
   * Extract uploaded image URLs from composition layers and delete them.
   * Only deletes URLs that look like our own uploads (contain /api/uploads/ or S3 bucket).
   */
  private tryDeleteCompositionAssets(composition: unknown): void {
    if (!composition || typeof composition !== "object") return;
    const comp = composition as { layers?: Array<{ photoUri?: string; imageUri?: string }> };
    if (!Array.isArray(comp.layers)) return;

    for (const layer of comp.layers) {
      if (layer.photoUri) this.tryDeleteUpload(layer.photoUri);
      if (layer.imageUri) this.tryDeleteUpload(layer.imageUri);
    }
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

  private buildFallbackSelectedSongs(body: CreateRepitDto): Repit["selectedSongs"] {
    if (!body.songTitle || !body.artistName || !body.platform) {
      return null;
    }

    return [
      {
        songLink: body.songLink ?? "",
        songTitle: body.songTitle,
        artistName: body.artistName,
        platform: body.platform,
        durationMs: body.durationMs ?? null,
        albumArtUrl: body.albumArt ?? null,
      },
    ];
  }

  private normalizeRepit(repit: Repit): Repit {
    return normalizeRepitState(repit) as Repit;
  }

  private getRepitLegacy(userId: string, id: string): Promise<Repit | null> {
    return this.repitsRepo
      .createQueryBuilder("repit")
      .select([
        "repit.id",
        "repit.userId",
        "repit.title",
        "repit.artist",
        "repit.status",
        "repit.platform",
        "repit.templateId",
        "repit.songLink",
        "repit.backgroundPhotoUrl",
        "repit.createdAt",
      ])
      .where("repit.id = :id", { id })
      .andWhere("repit.userId = :userId", { userId })
      .getOne();
  }

  private async listRepitsLegacy(userId: string, take: number, skip: number) {
    const [data, total] = await this.repitsRepo
      .createQueryBuilder("repit")
      .select([
        "repit.id",
        "repit.userId",
        "repit.title",
        "repit.artist",
        "repit.status",
        "repit.platform",
        "repit.templateId",
        "repit.songLink",
        "repit.backgroundPhotoUrl",
        "repit.createdAt",
      ])
      .where("repit.userId = :userId", { userId })
      .orderBy("repit.createdAt", "DESC")
      .take(take)
      .skip(skip)
      .getManyAndCount();

    return { data, total, limit: take, offset: skip };
  }

  private async createRepitLegacy(userId: string, body: CreateRepitDto): Promise<Repit> {
    const insertResult = await this.repitsRepo
      .createQueryBuilder()
      .insert()
      .into(Repit)
      .values({
        userId,
        title: body.songTitle ?? "Untitled Repitair",
        artist: body.artistName,
        platform: body.platform ?? "spotify",
        templateId: body.templateId,
        songLink: body.songLink ?? "",
        status: "draft",
        backgroundPhotoUrl: body.backgroundPhotoUrl ?? undefined,
      })
      .returning(["id"])
      .execute();

    const id = insertResult.identifiers[0]?.id as string | undefined;
    if (!id) {
      throw new Error("Could not create repit");
    }

    const repit = await this.getRepitLegacy(userId, id);
    if (!repit) {
      throw new Error("Created repit could not be loaded");
    }

    return repit;
  }

  private async updateRepitLegacy(userId: string, id: string, body: UpdateRepitDto): Promise<Repit | null> {
    const existing = await this.getRepitLegacy(userId, id);
    if (!existing) return null;

    const oldPhoto = existing.backgroundPhotoUrl;
    const newPhoto = body.backgroundPhotoUrl;
    const photoChanged = newPhoto !== undefined && newPhoto !== oldPhoto;

    const updatePayload: Record<string, unknown> = {
      templateId: body.templateId ?? existing.templateId,
      songLink: body.songLink !== undefined ? body.songLink ?? "" : existing.songLink,
      platform: body.platform ?? existing.platform,
      title: body.title ?? existing.title,
      artist: body.artist ?? existing.artist,
      status: body.status ?? existing.status,
    };
    if (body.backgroundPhotoUrl !== undefined) {
      updatePayload.backgroundPhotoUrl = body.backgroundPhotoUrl ?? null;
    }

    const updateResult = await this.repitsRepo
      .createQueryBuilder()
      .update(Repit)
      .set(updatePayload)
      .where("id = :id", { id })
      .andWhere("\"userId\" = :userId", { userId })
      .execute();

    if ((updateResult.affected ?? 0) === 0) {
      return null;
    }

    if (photoChanged && oldPhoto) {
      this.tryDeleteUpload(oldPhoto);
    }

    return this.getRepitLegacy(userId, id);
  }
}
