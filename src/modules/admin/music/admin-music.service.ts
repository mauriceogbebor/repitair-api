import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  MusicCollection,
  MusicConnection,
  MusicPlaylistImport,
  type MusicProviderName,
  User,
} from "../../../entities";
import { MusicConnectionsService } from "../../music/music-connections.service";
import { AdminListMusicConnectionsQueryDto } from "./dto/admin-music-query.dto";

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_IMPORT_MS = 7 * 24 * 60 * 60 * 1000;
const DETAIL_LIMIT = 20;

type ProviderCounts = {
  connected: number;
  reauthRequired: number;
  disconnected: number;
  total: number;
};

@Injectable()
export class AdminMusicService {
  constructor(
    @InjectRepository(MusicConnection)
    private readonly connectionsRepository: Repository<MusicConnection>,
    @InjectRepository(MusicPlaylistImport)
    private readonly importsRepository: Repository<MusicPlaylistImport>,
    @InjectRepository(MusicCollection)
    private readonly collectionsRepository: Repository<MusicCollection>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly connections: MusicConnectionsService,
  ) {}

  async overview() {
    const now = new Date();
    const expiryCutoff = new Date(now.getTime() + EXPIRING_SOON_MS);
    const importSince = new Date(now.getTime() - RECENT_IMPORT_MS);
    const statusQuery = this.connectionsRepository
      .createQueryBuilder("connection")
      .select("connection.provider", "provider")
      .addSelect("connection.status", "status")
      .addSelect("COUNT(*)", "count")
      .groupBy("connection.provider")
      .addGroupBy("connection.status");
    const expiringQuery = this.connectionsRepository
      .createQueryBuilder("connection")
      .where("connection.status = :status", { status: "connected" })
      .andWhere('connection."accessTokenExpiresAt" > :now', { now })
      .andWhere('connection."accessTokenExpiresAt" <= :expiryCutoff', { expiryCutoff });
    const recentImportQuery = this.importsRepository
      .createQueryBuilder("music_import")
      .select("COUNT(*)", "importCount")
      .addSelect('COALESCE(SUM(music_import."trackCount"), 0)', "trackCount")
      .where('music_import."importedAt" >= :importSince', { importSince });

    const [statusRows, expiringSoon, recentImports, totalCollections] = await Promise.all([
      statusQuery.getRawMany<{ provider: MusicProviderName; status: string; count: string }>(),
      expiringQuery.getCount(),
      recentImportQuery.getRawOne<{ importCount: string; trackCount: string }>(),
      this.collectionsRepository.count(),
    ]);

    const providers: Record<MusicProviderName, ProviderCounts> = {
      spotify: this.emptyCounts(),
      "apple-music": this.emptyCounts(),
    };
    for (const row of statusRows) {
      if (!(row.provider in providers)) continue;
      const count = Number(row.count);
      const counts = providers[row.provider];
      if (row.status === "connected") counts.connected = count;
      else if (row.status === "reauth_required") counts.reauthRequired = count;
      else if (row.status === "disconnected") counts.disconnected = count;
      counts.total += count;
    }

    return {
      generatedAt: now.toISOString(),
      providers,
      expiringSoon,
      expiryWindowDays: EXPIRING_SOON_MS / (24 * 60 * 60 * 1000),
      recentImports: {
        since: importSince.toISOString(),
        importCount: Number(recentImports?.importCount ?? 0),
        trackCount: Number(recentImports?.trackCount ?? 0),
      },
      totalCollections,
      callbackFailuresAvailable: false,
    };
  }

  async list(query: AdminListMusicConnectionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.connectionsRepository
      .createQueryBuilder("connection")
      .leftJoin("connection.user", "user")
      .addSelect("user.fullName", "userFullName")
      .orderBy("connection.updatedAt", "DESC");

    if (query.status) qb.andWhere("connection.status = :status", { status: query.status });
    if (query.provider) qb.andWhere("connection.provider = :provider", { provider: query.provider });
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        `(CAST(connection."userId" AS text) ILIKE :search
          OR connection."accountName" ILIKE :search
          OR connection."providerUserId" ILIKE :search
          OR user."fullName" ILIKE :search)`,
        { search: `%${search}%` },
      );
    }

    const total = await qb.getCount();
    const { entities, raw } = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getRawAndEntities();

    return {
      total,
      page,
      pageSize,
      records: entities.map((connection, index) => this.connectionRecord(
        connection,
        typeof raw[index]?.userFullName === "string" ? raw[index].userFullName : null,
      )),
    };
  }

  async userDetail(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, fullName: true },
    });
    if (!user) throw new NotFoundException("User not found");

    const [connections, imports, collections] = await Promise.all([
      this.connectionsRepository.find({ where: { userId }, order: { provider: "ASC" } }),
      this.importsRepository.find({
        where: { userId },
        select: { id: true, provider: true, playlistId: true, trackCount: true, importedAt: true },
        order: { importedAt: "DESC" },
        take: DETAIL_LIMIT,
      }),
      this.collectionsRepository.find({
        where: { ownerId: userId },
        select: {
          id: true,
          name: true,
          sourceProvider: true,
          trackCount: true,
          sourceSyncedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        order: { createdAt: "DESC" },
        take: DETAIL_LIMIT,
      }),
    ]);

    return {
      user: { id: user.id, fullName: user.fullName },
      connections: connections.map((connection) => this.connectionRecord(connection, user.fullName)),
      recentImports: imports.map((musicImport) => ({
        id: musicImport.id,
        provider: musicImport.provider,
        playlistId: musicImport.playlistId,
        trackCount: musicImport.trackCount,
        importedAt: this.iso(musicImport.importedAt),
      })),
      recentCollections: collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        sourceProvider: collection.sourceProvider,
        trackCount: collection.trackCount,
        sourceSyncedAt: this.iso(collection.sourceSyncedAt),
        createdAt: this.iso(collection.createdAt),
        updatedAt: this.iso(collection.updatedAt),
      })),
      syncHistory: {
        available: false,
        latestByProvider: connections
          .filter((connection) => connection.lastSyncedAt)
          .map((connection) => ({
            provider: connection.provider,
            lastSyncedAt: this.iso(connection.lastSyncedAt),
          })),
        note: "Only each provider's latest sync timestamp is currently persisted.",
      },
      callbackFailures: {
        available: false,
        note: "OAuth callback failures do not currently have a queryable persistence store.",
      },
    };
  }

  async requireReauthorization(userId: string, provider: MusicProviderName) {
    const before = await this.requireConnection(userId, provider);
    await this.connections.requireReauthorization(userId, provider, "ADMIN_REQUIRED_REAUTHORIZATION");
    const after = await this.requireConnection(userId, provider);
    return {
      targetId: before.id,
      before: this.connectionRecord(before),
      connection: this.connectionRecord(after),
    };
  }

  async disconnect(userId: string, provider: MusicProviderName) {
    const before = await this.requireConnection(userId, provider);
    await this.connections.disconnect(userId, provider);
    return {
      targetId: before.id,
      before: this.connectionRecord(before),
      disconnected: true,
      userId,
      provider,
    };
  }

  private async requireConnection(userId: string, provider: MusicProviderName) {
    const connection = await this.connectionsRepository.findOne({ where: { userId, provider } });
    if (!connection) throw new NotFoundException("Music provider connection not found");
    return connection;
  }

  private connectionRecord(connection: MusicConnection, userFullName: string | null = null) {
    return {
      id: connection.id,
      userId: connection.userId,
      userFullName,
      provider: connection.provider,
      status: connection.status,
      accountName: connection.accountName ?? null,
      providerUserId: connection.providerUserId ?? null,
      connectedAt: this.iso(connection.createdAt),
      tokenExpiresAt: this.iso(connection.accessTokenExpiresAt),
      lastSyncAt: this.iso(connection.lastSyncedAt),
      updatedAt: this.iso(connection.updatedAt),
      reauthRequired: connection.status === "reauth_required",
      lastErrorCode: connection.lastErrorCode ?? null,
    };
  }

  private iso(value?: Date | null): string | null {
    return value ? value.toISOString() : null;
  }

  private emptyCounts(): ProviderCounts {
    return { connected: 0, reauthRequired: 0, disconnected: 0, total: 0 };
  }
}
