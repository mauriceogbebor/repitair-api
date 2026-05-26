import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Full template redesign migration.
 *
 * Renames all 10 templates from the old design system to the new Figma design:
 *   sunrise   → noir        | Cinematic | Noir
 *   cyber     → luxe        | Premium   | Luxe
 *   mono      → motion      | Dynamic   | Motion
 *   neon-pulse→ street      | Urban     | Street
 *   vinyl     → glow        | Neon      | Glow
 *   midnight  → street-2    | Urban     | Street
 *   blush     → vibe        | Trendy    | Vibe
 *   anime     → noir-2      | Cinematic | Noir
 *   ocean     → lifestyle   | Casual    | Lifestyle
 *   pastel    → motion-2    | Dynamic   | Motion
 *
 * Also updates repits.templateId references so existing user data stays linked.
 */
export class RenameTemplatesToNewDesign1714600000000
  implements MigrationInterface
{
  /** old-id → { new id, name, style, category } */
  private readonly mapping = [
    { old: "sunrise",    id: "noir",      name: "Noir",      style: "Cinematic", category: "Noir" },
    { old: "cyber",      id: "luxe",      name: "Luxe",      style: "Premium",   category: "Luxe" },
    { old: "mono",       id: "motion",    name: "Motion",    style: "Dynamic",   category: "Motion" },
    { old: "neon-pulse", id: "street",    name: "Street",    style: "Urban",     category: "Street" },
    { old: "vinyl",      id: "glow",      name: "Glow",      style: "Neon",      category: "Glow" },
    { old: "midnight",   id: "street-2",  name: "Street",    style: "Urban",     category: "Street" },
    { old: "blush",      id: "vibe",      name: "Vibe",      style: "Trendy",    category: "Vibe" },
    { old: "anime",      id: "noir-2",    name: "Noir",      style: "Cinematic", category: "Noir" },
    { old: "ocean",      id: "lifestyle", name: "Lifestyle", style: "Casual",    category: "Lifestyle" },
    { old: "pastel",     id: "motion-2",  name: "Motion",    style: "Dynamic",   category: "Motion" },
  ];

  /** Reverse mapping for rollback */
  private readonly reverseMapping = [
    { old: "noir",      id: "sunrise",    name: "Sunrise",    style: "Minimal",   category: "Sunrise" },
    { old: "luxe",      id: "cyber",      name: "Cyber",      style: "Bold",      category: "Cyber" },
    { old: "motion",    id: "mono",       name: "Mono",       style: "Minimal",   category: "Mono" },
    { old: "street",    id: "neon-pulse", name: "Neon Pulse", style: "Bold",      category: "Neon Pulse" },
    { old: "glow",      id: "vinyl",      name: "Vinyl",      style: "Retro",     category: "Vinyl" },
    { old: "street-2",  id: "midnight",   name: "Midnight",   style: "Minimal",   category: "Midnight" },
    { old: "vibe",      id: "blush",      name: "Blush",      style: "Soft",      category: "Blush" },
    { old: "noir-2",    id: "anime",      name: "Anime",      style: "Bold",      category: "Anime" },
    { old: "lifestyle", id: "ocean",      name: "Ocean",      style: "Aesthetic", category: "Ocean" },
    { old: "motion-2",  id: "pastel",     name: "Pastel",     style: "Soft",      category: "Pastel" },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.renameTemplates(queryRunner, this.mapping);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.renameTemplates(queryRunner, this.reverseMapping);
  }

  /**
   * Renames templates via a temporary prefix to avoid primary-key collisions
   * when two templates swap IDs (e.g. if A→B and B→A).
   */
  private async renameTemplates(
    queryRunner: QueryRunner,
    map: { old: string; id: string; name: string; style: string; category: string }[],
  ): Promise<void> {
    // Step 1: Rename all old IDs to tmp_<old> to avoid PK collisions
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

    // Step 2: Rename tmp_<old> to final new IDs with updated metadata
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
