import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMusicConnectionsAndCollections1722200000000 implements MigrationInterface {
  name = "AddMusicConnectionsAndCollections1722200000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "music_connections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "provider" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'connected',
        "encryptedAccessToken" text,
        "encryptedRefreshToken" text,
        "accessTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "scopes" text array NOT NULL DEFAULT '{}',
        "providerUserId" character varying,
        "accountName" character varying,
        "playlistCount" integer,
        "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
        "lastErrorCode" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_music_connections" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_music_connections_user_provider" UNIQUE ("userId", "provider"),
        CONSTRAINT "FK_music_connections_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_music_connections_status" ON "music_connections" ("status")`);

    await queryRunner.query(`
      CREATE TABLE "music_oauth_states" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "provider" character varying NOT NULL,
        "stateHash" character varying NOT NULL,
        "encryptedCodeVerifier" text,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_music_oauth_states" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_music_oauth_states_hash" UNIQUE ("stateHash"),
        CONSTRAINT "FK_music_oauth_states_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_music_oauth_states_expiry" ON "music_oauth_states" ("expiresAt")`);

    await queryRunner.query(`
      CREATE TABLE "music_collections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ownerId" uuid NOT NULL,
        "shareCode" character varying NOT NULL,
        "name" character varying NOT NULL,
        "sourceProvider" character varying NOT NULL,
        "sourcePlaylistId" character varying,
        "artworkUrl" character varying,
        "tracks" jsonb NOT NULL,
        "trackCount" integer NOT NULL,
        "sourceSyncedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_music_collections" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_music_collections_share_code" UNIQUE ("shareCode"),
        CONSTRAINT "FK_music_collections_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_music_collections_owner_created" ON "music_collections" ("ownerId", "createdAt" DESC)`);

    await queryRunner.query(`
      CREATE TABLE "music_playlist_imports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "provider" character varying NOT NULL,
        "playlistId" character varying NOT NULL,
        "trackCount" integer NOT NULL,
        "importedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_music_playlist_imports" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_music_playlist_imports_user_provider_playlist" UNIQUE ("userId", "provider", "playlistId"),
        CONSTRAINT "FK_music_playlist_imports_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_music_playlist_imports_user_provider_imported" ON "music_playlist_imports" ("userId", "provider", "importedAt" DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "music_playlist_imports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "music_collections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "music_oauth_states"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "music_connections"`);
  }
}
