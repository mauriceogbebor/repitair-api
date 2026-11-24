/**
 * Publish (or unpublish) template rows by id.
 *
 * Templates are inserted as `status: 'draft'` and stay invisible to the public
 * API and un-saveable via createRepit until published. Run this ONCE a batch has
 * been certified on-device to flip the chosen templates live.
 *
 * Usage (DATABASE_URL must be set):
 *   node tools/publish-templates.js day cold-town coffee
 *   node tools/publish-templates.js --all-drafts
 *   node tools/publish-templates.js --dry-run day          # preview only
 *   node tools/publish-templates.js --unpublish day        # revert to draft
 *
 * Safety:
 *   - Publishing only flips rows currently in 'draft' (never touches a live row).
 *   - Unpublishing only flips rows currently in 'published'.
 *   - --dry-run makes no changes.
 *   - Requires explicit ids unless --all-drafts is passed.
 */
const { Client } = require("pg");

function parseArgs(argv) {
  const flags = new Set();
  const ids = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg.slice(2));
    else ids.push(arg);
  }
  return { flags, ids };
}

async function main() {
  const { flags, ids } = parseArgs(process.argv.slice(2));
  const dryRun = flags.has("dry-run");
  const unpublish = flags.has("unpublish");
  const allDrafts = flags.has("all-drafts");

  if (unpublish && allDrafts) {
    console.error("--unpublish and --all-drafts cannot be combined.");
    process.exit(1);
  }
  if (!allDrafts && ids.length === 0) {
    console.error("Provide template ids, or pass --all-drafts. Nothing to do.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const fromStatus = unpublish ? "published" : "draft";
  const toStatus = unpublish ? "draft" : "published";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Select the rows that WOULD change, for a clear before/after report.
    const where = allDrafts
      ? `"status" = $1`
      : `"id" = ANY($2) AND "status" = $1`;
    const selParams = allDrafts ? [fromStatus] : [fromStatus, ids];
    const { rows: targets } = await client.query(
      `SELECT "id", "name", "status", "isActive" FROM "templates" WHERE ${where} ORDER BY "sortOrder"`,
      selParams,
    );

    if (!allDrafts) {
      const found = new Set(targets.map((r) => r.id));
      for (const id of ids) {
        if (!found.has(id)) console.warn(`• ${id}: not in '${fromStatus}' status (skipped)`);
      }
    }

    if (targets.length === 0) {
      console.log(`No templates in '${fromStatus}' status to ${unpublish ? "unpublish" : "publish"}.`);
      return;
    }

    console.log(`${dryRun ? "[dry-run] would " : ""}${unpublish ? "unpublish" : "publish"} ${targets.length} template(s):`);
    for (const r of targets) console.log(`  ${r.id}  (${r.name})  ${r.status} -> ${toStatus}`);

    if (dryRun) return;

    const idList = targets.map((r) => r.id);
    const isActive = unpublish ? undefined : true; // publishing also ensures isActive
    const result = unpublish
      ? await client.query(
          `UPDATE "templates" SET "status" = $1 WHERE "id" = ANY($2) AND "status" = $3`,
          [toStatus, idList, fromStatus],
        )
      : await client.query(
          `UPDATE "templates" SET "status" = $1, "isActive" = $2 WHERE "id" = ANY($3) AND "status" = $4`,
          [toStatus, isActive, idList, fromStatus],
        );
    console.log(`Done — ${result.rowCount} row(s) updated.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
