import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Template v3 rename migration.
 *
 * Renames all 10 templates to the final production names:
 *   noir       → audioverse      | Immersive | Audioverse
 *   luxe       → echo-room       | Cinematic | Echo Room
 *   motion     → matcha-mood     | Warm      | Matcha Mood
 *   street     → midnight-mood   | Minimal   | Midnight Mood
 *   glow       → sonic-orbit     | Premium   | Sonic Orbit
 *   street-2   → soundscape      | Elegant   | Soundscape
 *   vibe       → air-wave        | Fresh     | Air Wave
 *   noir-2     → ice-girl        | Dynamic   | Ice Girl
 *   lifestyle  → minion          | Casual    | Minion
 *   motion-2   → motion-2        | Dynamic   | Motion (unchanged)
 *
 * Also updates repits.templateId references so existing user data stays linked.
 */
export class RenameTemplatesToV31714800000000
  implements MigrationInterface
{
  private readonly mapping = [
    { old: "noir",      id: "audioverse",     name: "Audioverse",     style: "Immersive", category: "Audioverse" },
    { old: "luxe",      id: "echo-room",      name: "Echo Room",      style: "Cinematic", category: "Echo Room" },
    { old: "motion",    id: "matcha-mood",     name: "Matcha Mood",    style: "Warm",      category: "Matcha Mood" },
    { old: "street",    id: "midnight-mood",   name: "Midnight Mood",  style: "Minimal",   category: "Midnight Mood" },
    { old: "glow",      id: "sonic-orbit",     name: "Sonic Orbit",    style: "Premium",   category: "Sonic Orbit" },
    { old: "street-2",  id: "soundscape",      name: "Soundscape",     style: "Elegant",   category: "Soundscape" },
    { old: "vibe",      id: "air-wave",        name: "Air Wave",       style: "Fresh",     category: "Air Wave" },
    { old: "noir-2",    id: "ice-girl",        name: "Ice Girl",       style: "Dynamic",   category: "Ice Girl" },
    { old: "lifestyle", id: "minion",          name: "Minion",         style: "Casual",    category: "Minion" },
    // motion-2 stays the same — only update name/style/category
  ];

  private readonly reverseMapping = [
    { old: "audioverse",    id: "noir",      name: "Noir",      style: "Cinematic", category: "Noir" },
    { old: "echo-room",     id: "luxe",      name: "Luxe",      style: "Premium",   category: "Luxe" },
    { old: "matcha-mood",   id: "motion",    name: "Motion",    style: "Dynamic",   category: "Motion" },
    { old: "midnight-mood", id: "street",    name: "Street",    style: "Urban",     category: "Street" },
    { old: "sonic-orbit",   id: "glow",      name: "Glow",      style: "Neon",      category: "Glow" },
    { old: "soundscape",    id: "street-2",  name: "Street",    style: "Urban",     category: "Street" },
    { old: "air-wave",      id: "vibe",      name: "Vibe",      style: "Trendy",    category: "Vibe" },
    { old: "ice-girl",      id: "noir-2",    name: "Noir",      style: "Cinematic", category: "Noir" },
    { old: "minion",        id: "lifestyle", name: "Lifestyle", style: "Casual",    category: "Lifestyle" },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.renameTemplates(queryRunner, this.mapping);

    // Update motion-2 metadata (id stays the same)
    await queryRunner.query(
      `UPDATE "templates" SET "name" = $1, "style" = $2, "category" = $3 WHERE "id" = $4`,
      ["Motion", "Dynamic", "Motion", "motion-2"],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.renameTemplates(queryRunner, this.reverseMapping);

    // Revert motion-2 metadata
    await queryRunner.query(
      `UPDATE "templates" SET "name" = $1, "style" = $2, "category" = $3 WHERE "id" = $4`,
      ["Motion", "Dynamic", "Motion", "motion-2"],
    );
  }

  private async renameTemplates(
    queryRunner: QueryRunner,
    map: { old: string; id: string; name: string; style: string; category: string }[],
  ): Promise<void> {
    // Step 1: Rename to tmp_ prefix to avoid PK collisions
    for (const m of map) {
      await queryRunner.query(
        `UPDATE "templates" SET "id" = $1 WHERE "id" = $2`,
        [`tmp_${m.old}`, m.old],
      );
      await queryRunner.query(
        `UPDATE "repits" SET "templateId" = $1 WHERE "templateId" = $2`,
        [`tmp_${m.old}`, m.old],
      );
    }

    // Step 2: Rename tmp_ to final IDs with updated metadata
    for (const m of map) {
      await queryRunner.query(
        `UPDATE "templates"
         SET "id" = $1, "name" = $2, "style" = $3, "category" = $4
         WHERE "id" = $5`,
        [m.id, m.name, m.style, m.category, `tmp_${m.old}`],
      );
      await queryRunner.query(
        `UPDATE "repits" SET "templateId" = $1 WHERE "templateId" = $2`,
        [m.id, `tmp_${m.old}`],
      );
    }
  }
}
