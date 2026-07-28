import { createHash } from "node:crypto";
import type { Repository } from "typeorm";
import type { AdminAuditLog } from "../../entities/admin-audit-log.entity";
import type { ContactSubmission } from "../../entities/contact-submission.entity";
import type { PrivacyJob } from "../../entities/privacy-job.entity";
import type { PrivacyRequest } from "../../entities/privacy-request.entity";
import type { PushToken } from "../../entities/push-token.entity";
import type { Repit } from "../../entities/repit.entity";
import type { User } from "../../entities/user.entity";
import { PrivacyExecutionService } from "./privacy-execution.service";

describe("PrivacyExecutionService data export delivery", () => {
  function setup(mailResult: "success" | "failure" = "success") {
    const jobs = {
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      }),
    };
    const users = {
      findOne: jest.fn().mockResolvedValue({
        id: "user-1",
        email: "data-subject@example.test",
        fullName: "Data Subject",
        country: "NG",
        connectedPlatforms: [],
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    };
    const repits = { find: jest.fn().mockResolvedValue([]) };
    const support = { find: jest.fn().mockResolvedValue([]) };
    const auditLogs = { find: jest.fn().mockResolvedValue([]) };
    const workflow = {
      recordFulfilment: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const mail = {
      sendPrivacyExportReady: mailResult === "success"
        ? jest.fn().mockResolvedValue(undefined)
        : jest.fn().mockRejectedValue(new Error("SMTP unavailable")),
    };
    const config = {
      get: jest.fn((key: string) => key === "PUBLIC_URL" ? "https://api.example.test" : undefined),
    };
    const service = new PrivacyExecutionService(
      jobs as unknown as Repository<PrivacyJob>,
      users as unknown as Repository<User>,
      repits as unknown as Repository<Repit>,
      {} as Repository<PushToken>,
      support as unknown as Repository<ContactSubmission>,
      auditLogs as unknown as Repository<AdminAuditLog>,
      {} as never,
      workflow as never,
      mail as never,
      config as never,
      {} as never,
    );
    return { service, jobs, workflow, mail };
  }

  const request = {
    id: "request-1",
    userId: "user-1",
    userEmail: "data-subject@example.test",
  } as PrivacyRequest;

  it("delivers a one-use plaintext token while persisting only its hash", async () => {
    const { service, jobs, workflow, mail } = setup();

    const result = await service.runExport(request);

    expect(result.status).toBe("succeeded");
    expect(mail.sendPrivacyExportReady).toHaveBeenCalledTimes(1);
    const downloadUrl = mail.sendPrivacyExportReady.mock.calls[0][2] as string;
    const token = downloadUrl.split("/").at(-1)!;
    expect(downloadUrl).toMatch(/^https:\/\/api\.example\.test\/api\/privacy\/export\//);
    expect(result.downloadTokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(result.downloadTokenHash).not.toBe(token);
    expect(result.result).not.toHaveProperty("downloadTokenHash");
    expect(workflow.recordFulfilment).toHaveBeenCalledWith(
      "request-1",
      expect.objectContaining({ result: "generated_and_delivered" }),
      {},
    );
    expect(jobs.save).toHaveBeenCalled();
  });

  it("does not mark an export delivered when SMTP fails", async () => {
    const { service, workflow } = setup("failure");

    const result = await service.runExport(request);

    expect(result.status).toBe("retry_required");
    expect(result.downloadTokenHash).toBeNull();
    expect(result.downloadExpiresAt).toBeNull();
    expect(workflow.recordFulfilment).not.toHaveBeenCalled();
    expect(workflow.markFailed).toHaveBeenCalledWith(
      "request-1",
      "Export failed: SMTP unavailable",
      {},
    );
  });
});
