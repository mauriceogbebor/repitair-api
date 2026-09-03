#!/usr/bin/env node

const { spawn } = require("child_process");
const { Client } = require("pg");

const LOCK_NAMESPACE = 1_382_135;
const LOCK_ID = 1;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to run migrations");

  const client = new Client({ connectionString });
  await client.connect();
  let locked = false;
  try {
    console.log("Waiting for the Repitair migration lock...");
    await client.query("SELECT pg_advisory_lock($1, $2)", [LOCK_NAMESPACE, LOCK_ID]);
    locked = true;
    console.log("Migration lock acquired");

    const cli = require.resolve("typeorm/cli.js");
    const child = spawn(process.execPath, [cli, "migration:run", "-d", "dist/data-source.js"], {
      env: process.env,
      stdio: "inherit",
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) reject(new Error(`Migration process terminated by ${signal}`));
        else resolve(code ?? 1);
      });
    });
    if (exitCode !== 0) throw new Error(`Migration process exited with code ${exitCode}`);
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_NAMESPACE, LOCK_ID]);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
