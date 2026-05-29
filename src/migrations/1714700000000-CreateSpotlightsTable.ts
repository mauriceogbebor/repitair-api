import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class CreateSpotlightsTable1714700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "spotlights",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, generationStrategy: "uuid", default: "uuid_generate_v4()" },
          { name: "title", type: "varchar", isNullable: false },
          { name: "artist", type: "varchar", isNullable: false },
          { name: "albumArt", type: "varchar", isNullable: false },
          { name: "tag", type: "varchar", default: "'NEW_SINGLE'" },
          { name: "deepLink", type: "varchar", isNullable: true },
          { name: "priority", type: "int", default: 0 },
          { name: "status", type: "varchar", default: "'pending'" },
          { name: "impressionCount", type: "int", default: 0 },
          { name: "startsAt", type: "timestamptz", isNullable: true },
          { name: "expiresAt", type: "timestamptz", isNullable: true },
          { name: "submitterEmail", type: "varchar", isNullable: true },
          { name: "createdAt", type: "timestamptz", default: "now()" },
          { name: "updatedAt", type: "timestamptz", default: "now()" },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("spotlights");
  }
}
