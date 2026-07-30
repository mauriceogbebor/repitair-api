import type { QueryRunner } from "typeorm";

import {
  AUDIOVERSE_TEMPLATE_ID,
  ProvisionAudioverseIsolationCapabilities1722000000000,
} from "./1722000000000-ProvisionAudioverseIsolationCapabilities";

describe("ProvisionAudioverseIsolationCapabilities1722000000000", () => {
  it("guards the authoritative row, snapshots it, and merges both capabilities", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ id: AUDIOVERSE_TEMPLATE_ID }])
      .mockResolvedValue(undefined);
    const migration = new ProvisionAudioverseIsolationCapabilities1722000000000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toContain(`"status" = 'published'`);
    expect(query.mock.calls[0][0]).toContain(`"isActive" = true`);
    expect(query.mock.calls[0][1]).toEqual([AUDIOVERSE_TEMPLATE_ID]);
    expect(query.mock.calls[1][0]).toContain(`INSERT INTO "template_versions"`);
    expect(query.mock.calls[1][0]).toContain(`NOT EXISTS`);
    expect(query.mock.calls[2][0]).toContain(`jsonb_typeof("capabilities") <> 'object'`);
    expect(query.mock.calls[2][0]).toContain(`"supportsIsolatedSubject": true`);
    expect(query.mock.calls[2][0]).toContain(`"requiresBackgroundRemoval": true`);
    expect(query.mock.calls[2][1]).toEqual([AUDIOVERSE_TEMPLATE_ID]);
  });

  it("fails before writing when the published active Audioverse row is absent", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const migration = new ProvisionAudioverseIsolationCapabilities1722000000000();

    await expect(migration.up({ query } as unknown as QueryRunner)).rejects.toThrow(
      'published active template "audioverse" was not found',
    );

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("restores the exact capability snapshot and removes only its marker", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new ProvisionAudioverseIsolationCapabilities1722000000000();

    await migration.down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain(
      `snapshot."snapshot" -> 'capabilities' = 'null'::jsonb`,
    );
    expect(query.mock.calls[0][1]).toEqual([
      AUDIOVERSE_TEMPLATE_ID,
      expect.stringContaining("Audioverse isolation"),
    ]);
    expect(query.mock.calls[1][0]).toContain(`DELETE FROM "template_versions"`);
  });
});
