const { Client } = require("pg");

const EXPECTED_TABLES = [
  "music_collections",
  "music_connections",
  "music_oauth_states",
  "music_playlist_imports",
];

const EXPECTED_INDEXES = [
  "IDX_music_collections_owner_created",
  "IDX_music_connections_status",
  "IDX_music_oauth_states_expiry",
  "IDX_music_playlist_imports_user_provider_imported",
];

const EXPECTED_CONSTRAINTS = [
  "FK_music_collections_owner",
  "FK_music_connections_user",
  "FK_music_oauth_states_user",
  "FK_music_playlist_imports_user",
  "UQ_music_collections_share_code",
  "UQ_music_connections_user_provider",
  "UQ_music_oauth_states_hash",
  "UQ_music_playlist_imports_user_provider_playlist",
];

async function countRows(client, tableName) {
  const exists = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${tableName}`]);
  if (!exists.rows[0].exists) return null;
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM "${tableName}"`);
  return result.rows[0].count;
}

async function main() {
  const expectedState = process.argv[2] ?? "present";
  if (!new Set(["present", "absent"]).has(expectedState)) {
    throw new Error("Expected state must be 'present' or 'absent'.");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const tables = await client.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])
       ORDER BY tablename`,
      [EXPECTED_TABLES],
    );
    const indexes = await client.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [EXPECTED_INDEXES],
    );
    const constraints = await client.query(
      `SELECT constraint_name
       FROM information_schema.table_constraints
       WHERE constraint_schema = 'public' AND constraint_name = ANY($1::text[])
       ORDER BY constraint_name`,
      [EXPECTED_CONSTRAINTS],
    );
    const migration = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM migrations
       WHERE name = 'AddMusicConnectionsAndCollections1722200000000'`,
    );

    const observed = {
      tables: tables.rows.map((row) => row.tablename),
      indexes: indexes.rows.map((row) => row.indexname),
      constraints: constraints.rows.map((row) => row.constraint_name),
      migrationRows: migration.rows[0].count,
      rowCounts: {
        users: await countRows(client, "users"),
        repits: await countRows(client, "repits"),
        templates: await countRows(client, "templates"),
        musicConnections: await countRows(client, "music_connections"),
        musicCollections: await countRows(client, "music_collections"),
        musicOAuthStates: await countRows(client, "music_oauth_states"),
        musicPlaylistImports: await countRows(client, "music_playlist_imports"),
      },
    };

    console.log(JSON.stringify({ expectedState, observed }, null, 2));

    const isPresent =
      observed.tables.length === EXPECTED_TABLES.length &&
      observed.indexes.length === EXPECTED_INDEXES.length &&
      observed.constraints.length === EXPECTED_CONSTRAINTS.length &&
      observed.migrationRows === 1;
    const isAbsent =
      observed.tables.length === 0 &&
      observed.indexes.length === 0 &&
      observed.constraints.length === 0 &&
      observed.migrationRows === 0;

    if ((expectedState === "present" && !isPresent) || (expectedState === "absent" && !isAbsent)) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
