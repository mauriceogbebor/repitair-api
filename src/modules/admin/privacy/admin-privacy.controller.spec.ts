import { ForbiddenException } from "@nestjs/common";
import type { Repository } from "typeorm";
import type { AdminUser } from "../../../entities/admin-user.entity";
import type { AdminRequest } from "../admin.types";
import { AdminPrivacyController } from "./admin-privacy.controller";

describe("AdminPrivacyController operation permissions", () => {
  const request = (permissionKeys: string[]): AdminRequest => ({
    adminUser: {
      id: "admin-1",
      email: "operator@example.test",
      permissionKeys,
    },
    adminRequestContext: { requestId: "correlation-1" },
  } as AdminRequest);

  function setup(type: "data_export" | "account_deletion" | "data_access") {
    const workflow = {
      transition: jest.fn().mockResolvedValue(undefined),
      transitionWith: jest.fn().mockImplementation(async (_id, _to, _ctx, participant) => {
        await participant({ getRepository: jest.fn() });
      }),
    };
    const queries = {
      detail: jest.fn().mockResolvedValue({
        request: { id: "request-1", userId: "user-1", type, status: "approved" },
      }),
    };
    const platformJobs = { enqueueWithManager: jest.fn().mockResolvedValue({ id: "job-1" }) };
    const controller = new AdminPrivacyController(
      workflow as never,
      queries as never,
      {} as never,
      platformJobs as never,
      {} as Repository<AdminUser>,
    );
    return { controller, workflow, platformJobs };
  }

  it("does not let privacy.process substitute for privacy.export", async () => {
    const { controller, workflow } = setup("data_export");

    await expect(controller.process(
      "request-1",
      request(["privacy.process"]),
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(workflow.transitionWith).not.toHaveBeenCalled();
  });

  it("does not let privacy.process substitute for privacy.delete", async () => {
    const { controller, workflow } = setup("account_deletion");

    await expect(controller.process(
      "request-1",
      request(["privacy.process", "privacy.export"]),
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(workflow.transitionWith).not.toHaveBeenCalled();
  });

  it("commits processing through the transaction-aware queue path", async () => {
    const { controller, workflow, platformJobs } = setup("data_export");

    await controller.process(
      "request-1",
      request(["privacy.process", "privacy.export"]),
    );

    expect(workflow.transitionWith).toHaveBeenCalledWith(
      "request-1",
      "processing",
      expect.any(Object),
      expect.any(Function),
    );
    expect(platformJobs.enqueueWithManager).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        type: "privacy.data_export",
        idempotencyKey: "privacy-export:request-1",
      }),
    );
  });

  it("opens manual fulfilment without enqueueing an unsupported job type", async () => {
    const { controller, workflow, platformJobs } = setup("data_access");

    await controller.process(
      "request-1",
      request(["privacy.process"]),
    );

    expect(workflow.transition).toHaveBeenCalledWith(
      "request-1",
      "processing",
      expect.any(Object),
    );
    expect(workflow.transitionWith).not.toHaveBeenCalled();
    expect(platformJobs.enqueueWithManager).not.toHaveBeenCalled();
  });
});
