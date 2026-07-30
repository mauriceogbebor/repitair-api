import type { QueryRunner } from "typeorm";

import {
  RELEASE_ONE_TEMPLATE_IDS,
  RestoreReleaseOneTemplatePublication1721900000000,
} from "./1721900000000-RestoreReleaseOneTemplatePublication";

describe("RestoreReleaseOneTemplatePublication1721900000000", () => {
  it("publishes only the ten established Release 1 templates", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new RestoreReleaseOneTemplatePublication1721900000000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(RELEASE_ONE_TEMPLATE_IDS).toEqual([
      "audioverse",
      "echo-room",
      "matcha-mood",
      "midnight-mood",
      "sonic-orbit",
      "soundscape",
      "air-wave",
      "ice-girl",
      "minion",
      "pink-replay",
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`INSERT INTO "template_versions"`),
      [RELEASE_ONE_TEMPLATE_IDS, expect.stringContaining("discovery regression")],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`"status" = 'published'`),
      [RELEASE_ONE_TEMPLATE_IDS],
    );
    expect(query.mock.calls[1][0]).toContain(`"isActive" = true`);
    expect(query.mock.calls[1][0]).toContain(`"status" = 'draft'`);
    expect(query.mock.calls[1][0]).toContain(`"id" = ANY($1::varchar[])`);
    expect(query.mock.calls[0][0]).toContain(`$2::varchar`);
  });

  it("reverts only rows marked by this migration", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new RestoreReleaseOneTemplatePublication1721900000000();

    await migration.down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`FROM "template_versions"`),
      [RELEASE_ONE_TEMPLATE_IDS, expect.stringContaining("discovery regression")],
    );
    expect(query.mock.calls[0][0]).toContain(`'draft'`);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`DELETE FROM "template_versions"`),
      [RELEASE_ONE_TEMPLATE_IDS, expect.stringContaining("discovery regression")],
    );
  });
});
