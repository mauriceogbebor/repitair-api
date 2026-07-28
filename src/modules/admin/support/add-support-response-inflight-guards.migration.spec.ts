import { QueryRunner } from "typeorm";
import { AddSupportResponseInflightGuards1721500000000 } from "../../../migrations/1721500000000-AddSupportResponseInflightGuards";

describe("AddSupportResponseInflightGuards1721500000000", () => {
  it("quarantines historical duplicate queued rows before creating the unique index", async () => {
    const queries: string[] = [];
    const queryRunner = { query: jest.fn(async (sql: string) => queries.push(sql)) } as unknown as QueryRunner;

    await new AddSupportResponseInflightGuards1721500000000().up(queryRunner);

    const quarantineIndex = queries.findIndex((sql) => sql.includes("ranked_queued"));
    const uniqueIndex = queries.findIndex((sql) => sql.includes("UQ_support_response_single_inflight_per_case"));
    expect(quarantineIndex).toBeGreaterThan(-1);
    expect(uniqueIndex).toBeGreaterThan(quarantineIndex);
    expect(queries[quarantineIndex]).toContain("delivery_unknown");
    expect(queries[quarantineIndex]).toContain("queue_rank > 1");
  });

  it("restores quarantined rows before removing the attempt timestamp on rollback", async () => {
    const queries: string[] = [];
    const queryRunner = { query: jest.fn(async (sql: string) => queries.push(sql)) } as unknown as QueryRunner;

    await new AddSupportResponseInflightGuards1721500000000().down(queryRunner);

    expect(queries[0]).toContain("DROP INDEX");
    expect(queries[1]).toContain("SET \"status\" = 'queued'");
    expect(queries[2]).toContain("DROP COLUMN");
  });
});
