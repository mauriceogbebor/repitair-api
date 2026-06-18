import "reflect-metadata";

import dataSource from "../data-source";
import { Repit, Template } from "../entities";
import {
  buildRepitCompositionBackfillPayload,
  buildTemplateCompositionBackfillPayload,
} from "../common/composition/composition-backfill";

type Counters = {
  scanned: number;
  upgraded: number;
  skipped: number;
  failed: number;
};

type ScriptOptions = {
  dryRun: boolean;
  json: boolean;
};

const BATCH_SIZE = 200;

function parseOptions(): ScriptOptions {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has("--dry-run"),
    json: args.has("--json"),
  };
}

function logLine(message: string, options: ScriptOptions) {
  if (!options.json) {
    console.log(message);
  }
}

function logError(message: string, error: unknown, options: ScriptOptions) {
  if (!options.json) {
    console.error(message, error);
  }
}

function logSummary(label: string, counters: Counters, options: ScriptOptions) {
  if (options.json) return;

  console.log(
    `[composition-backfill] ${label}: scanned=${counters.scanned} upgraded=${counters.upgraded} skipped=${counters.skipped} failed=${counters.failed}`,
  );
}

async function backfillTemplates(options: ScriptOptions) {
  const repo = dataSource.getRepository(Template);
  const counters: Counters = { scanned: 0, upgraded: 0, skipped: 0, failed: 0 };

  const templates = await repo.find({ order: { sortOrder: "ASC" } });
  for (const template of templates) {
    counters.scanned += 1;
    const payload = buildTemplateCompositionBackfillPayload(template);

    if (!payload) {
      counters.skipped += 1;
      logLine(`[composition-backfill] template ${template.id}: skipped`, options);
      continue;
    }

    try {
      if (!options.dryRun) {
        await repo.save({
          ...template,
          ...payload,
        });
      }
      counters.upgraded += 1;
      logLine(
        `[composition-backfill] template ${template.id}: ${options.dryRun ? "would-upgrade" : "upgraded"}`,
        options,
      );
    } catch (error) {
      counters.failed += 1;
      logError(`[composition-backfill] template ${template.id}: failed`, error, options);
    }
  }

  logSummary("templates", counters, options);
  return counters;
}

async function backfillRepits(options: ScriptOptions) {
  const repitRepo = dataSource.getRepository(Repit);
  const templateRepo = dataSource.getRepository(Template);
  const counters: Counters = { scanned: 0, upgraded: 0, skipped: 0, failed: 0 };

  let offset = 0;
  while (true) {
    const repits = await repitRepo.find({
      order: { createdAt: "ASC" },
      skip: offset,
      take: BATCH_SIZE,
    });

    if (repits.length === 0) {
      break;
    }

    for (const repit of repits) {
      counters.scanned += 1;
      const template = await templateRepo.findOne({ where: { id: repit.templateId } });
      const payload = buildRepitCompositionBackfillPayload(repit, template);

      if (!payload) {
        counters.skipped += 1;
        logLine(`[composition-backfill] repit ${repit.id}: skipped`, options);
        continue;
      }

      try {
        if (!options.dryRun) {
          await repitRepo.save({
            ...repit,
            ...payload,
          });
        }
        counters.upgraded += 1;
        logLine(
          `[composition-backfill] repit ${repit.id}: ${options.dryRun ? "would-upgrade" : "upgraded"}`,
          options,
        );
      } catch (error) {
        counters.failed += 1;
        logError(`[composition-backfill] repit ${repit.id}: failed`, error, options);
      }
    }

    offset += repits.length;
  }

  logSummary("repits", counters, options);
  return counters;
}

async function main() {
  const options = parseOptions();
  await dataSource.initialize();

  try {
    const templates = await backfillTemplates(options);
    const repits = await backfillRepits(options);

    if (options.json) {
      console.log(JSON.stringify({
        dryRun: options.dryRun,
        templates,
        repits,
      }, null, 2));
    } else {
      console.log(`[composition-backfill] mode=${options.dryRun ? "dry-run" : "write"}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error("[composition-backfill] fatal", error);
  process.exitCode = 1;
});
