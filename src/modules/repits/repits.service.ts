import { Injectable, OnModuleInit } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CreateRepitDto } from "./dto/create-repit.dto";
import { UpdateRepitDto } from "./dto/update-repit.dto";

type RepitRecord = {
  id: string;
  title: string;
  artist?: string;
  status: string;
  platform: string;
  templateId: string;
  songLink: string;
  backgroundPhotoUrl?: string;
  createdAt: string;
};

const seedRepits: RepitRecord[] = [
  {
    id: "repit_1",
    title: "Highest in the room",
    artist: "Travis Scott",
    createdAt: new Date("2026-03-01T10:00:00.000Z").toISOString(),
    platform: "spotify",
    songLink: "https://open.spotify.com/track/example",
    status: "shared",
    templateId: "sunrise"
  }
];

@Injectable()
export class RepitsService implements OnModuleInit {
  private readonly storagePath = join(process.cwd(), "data", "repits.json");
  private repits: RepitRecord[] = [];
  private nextId = 1;
  private writeQueue: Promise<void> = Promise.resolve();

  async onModuleInit() {
    this.repits = await this.readRepits();
    this.nextId = this.getNextId(this.repits);
  }

  listRepits() {
    return this.repits;
  }

  async createRepit(body: CreateRepitDto) {
    const repit: RepitRecord = {
      id: `repit_${this.nextId}`,
      title: body.songTitle ?? "Untitled Repitair",
      artist: body.artistName,
      createdAt: new Date().toISOString(),
      platform: body.platform ?? "spotify",
      templateId: body.templateId,
      songLink: body.songLink,
      status: "draft",
      backgroundPhotoUrl: body.backgroundPhotoUrl
    };

    this.nextId += 1;
    this.repits = [repit, ...this.repits];
    await this.persistRepits();

    return repit;
  }

  async updateRepit(id: string, body: UpdateRepitDto) {
    const existing = this.repits.find((repit) => repit.id === id);

    if (!existing) {
      return null;
    }

    const updated: RepitRecord = {
      ...existing,
      artist: body.artist ?? existing.artist,
      backgroundPhotoUrl: body.backgroundPhotoUrl ?? existing.backgroundPhotoUrl,
      status: body.status ?? existing.status,
      title: body.title ?? existing.title
    };

    this.repits = this.repits.map((repit) => (repit.id === id ? updated : repit));
    await this.persistRepits();

    return updated;
  }

  async deleteRepit(id: string) {
    const before = this.repits.length;
    this.repits = this.repits.filter((repit) => repit.id !== id);

    if (this.repits.length === before) {
      return false;
    }

    await this.persistRepits();
    return true;
  }

  private async readRepits() {
    try {
      const file = await readFile(this.storagePath, "utf8");
      const parsed = JSON.parse(file) as RepitRecord[];
      return parsed.length ? parsed : [...seedRepits];
    } catch {
      await this.persistSeedRepits();
      return [...seedRepits];
    }
  }

  private async persistSeedRepits() {
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, JSON.stringify(seedRepits, null, 2), "utf8");
  }

  private getNextId(repits: RepitRecord[]) {
    const maxId = repits.reduce((currentMax, repit) => {
      const suffix = Number(repit.id.replace("repit_", ""));
      return Number.isFinite(suffix) ? Math.max(currentMax, suffix) : currentMax;
    }, 0);

    return maxId + 1;
  }

  private async persistRepits() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.storagePath), { recursive: true });
      await writeFile(this.storagePath, JSON.stringify(this.repits, null, 2), "utf8");
    });

    await this.writeQueue;
  }
}
