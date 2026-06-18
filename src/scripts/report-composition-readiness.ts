import "reflect-metadata";

import dataSource from "../data-source";
import { Repit, Template } from "../entities";
import {
  DEFAULT_CANVAS_META,
  normalizeCanvasMeta,
  sanitizeRepitComposition,
  sanitizeTemplateComposition,
} from "../common/composition/composition.utils";

type ReportCounts = {
  total: number;
  validComposition: number;
  withoutComposition: number;
  invalidComposition: number;
};

type ScriptOptions = {
  json: boolean;
};

function parseOptions(): ScriptOptions {
  const args = new Set(process.argv.slice(2));
  return {
    json: args.has("--json"),
  };
}

async function reportRepits(): Promise<ReportCounts> {
  const repo = dataSource.getRepository(Repit);
  const repits = await repo.find();

  const counts: ReportCounts = {
    total: repits.length,
    validComposition: 0,
    withoutComposition: 0,
    invalidComposition: 0,
  };

  for (const repit of repits) {
    if (repit.composition == null) {
      counts.withoutComposition += 1;
      continue;
    }

    const composition = sanitizeRepitComposition(repit.composition, {
      context: `report:repit:${repit.id}`,
      templateId: repit.templateId,
      templateVersion: repit.templateVersion ?? null,
      fallbackCanvasMeta: normalizeCanvasMeta(repit.canvasMeta, DEFAULT_CANVAS_META),
    });

    if (composition) {
      counts.validComposition += 1;
    } else {
      counts.invalidComposition += 1;
    }
  }

  return counts;
}

async function reportTemplates(): Promise<ReportCounts> {
  const repo = dataSource.getRepository(Template);
  const templates = await repo.find();

  const counts: ReportCounts = {
    total: templates.length,
    validComposition: 0,
    withoutComposition: 0,
    invalidComposition: 0,
  };

  for (const template of templates) {
    if (template.composition == null) {
      counts.withoutComposition += 1;
      continue;
    }

    const composition = sanitizeTemplateComposition(template.composition, {
      context: `report:template:${template.id}`,
      templateId: template.id,
      templateVersion: template.templateVersion ?? null,
      fallbackCanvasMeta: normalizeCanvasMeta(template.canvasMeta, DEFAULT_CANVAS_META),
    });

    if (composition) {
      counts.validComposition += 1;
    } else {
      counts.invalidComposition += 1;
    }
  }

  return counts;
}

async function main() {
  const options = parseOptions();
  await dataSource.initialize();

  try {
    const repits = await reportRepits();
    const templates = await reportTemplates();
    const report = {
      generatedAt: new Date().toISOString(),
      repits,
      templates,
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log("[composition-report] Repits");
    console.log(`  total=${repits.total}`);
    console.log(`  validComposition=${repits.validComposition}`);
    console.log(`  withoutComposition=${repits.withoutComposition}`);
    console.log(`  invalidComposition=${repits.invalidComposition}`);
    console.log("[composition-report] Templates");
    console.log(`  total=${templates.total}`);
    console.log(`  validComposition=${templates.validComposition}`);
    console.log(`  withoutComposition=${templates.withoutComposition}`);
    console.log(`  invalidComposition=${templates.invalidComposition}`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error("[composition-report] fatal", error);
  process.exitCode = 1;
});
