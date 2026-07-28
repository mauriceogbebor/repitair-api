import type { EntityManager, Repository } from "typeorm";
import type { PrivacyRequest } from "../../entities/privacy-request.entity";
import { PrivacyEvent } from "../../entities/privacy-event.entity";
import { PrivacyRequest as PrivacyRequestEntity } from "../../entities/privacy-request.entity";
import { PrivacyWorkflowService } from "./privacy-workflow.service";

describe("PrivacyWorkflowService transactional transitions", () => {
  const request = (): PrivacyRequest => ({
    id: "request-1",
    userId: "user-1",
    type: "data_export",
    status: "approved",
    priority: "medium",
    retryCount: 0,
    escalationLevel: 0,
    verificationStatus: "unverified",
    assignmentHistory: [],
  } as unknown as PrivacyRequest);

  it("runs the durable participant in the same transaction before event and audit writes", async () => {
    const entity = request();
    const requestRepository = {
      findOne: jest.fn().mockResolvedValue(entity),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const eventRepository = {
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((target) => (
        target === PrivacyRequestEntity ? requestRepository : eventRepository
      )),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const participant = jest.fn().mockResolvedValue(undefined);
    const service = new PrivacyWorkflowService(
      {} as Repository<PrivacyRequest>,
      {} as Repository<PrivacyEvent>,
      audit as never,
      dataSource as never,
    );

    await service.transitionWith("request-1", "processing", {}, participant);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(participant).toHaveBeenCalledWith(manager, entity);
    expect(eventRepository.save).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(expect.any(Object), manager);
    expect(participant.mock.invocationCallOrder[0]).toBeLessThan(
      eventRepository.save.mock.invocationCallOrder[0],
    );
  });

  it("does not write a timeline event or audit record when durable enqueue fails", async () => {
    const entity = request();
    const requestRepository = {
      findOne: jest.fn().mockResolvedValue(entity),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const eventRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn((target) => (
        target === PrivacyRequestEntity ? requestRepository : eventRepository
      )),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const audit = { append: jest.fn() };
    const service = new PrivacyWorkflowService(
      {} as Repository<PrivacyRequest>,
      {} as Repository<PrivacyEvent>,
      audit as never,
      dataSource as never,
    );

    await expect(service.transitionWith(
      "request-1",
      "processing",
      {},
      async () => {
        throw new Error("queue unavailable");
      },
    )).rejects.toThrow("queue unavailable");

    expect(eventRepository.save).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it("routes failed fulfilment verification into the retryable failed state", async () => {
    const entity = { ...request(), status: "processing" } as PrivacyRequest;
    const requestRepository = {
      findOne: jest.fn().mockResolvedValue(entity),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const eventRepository = {
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((target) => (
        target === PrivacyRequestEntity ? requestRepository : eventRepository
      )),
    } as unknown as EntityManager;
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new PrivacyWorkflowService(
      {} as Repository<PrivacyRequest>,
      {} as Repository<PrivacyEvent>,
      audit as never,
      { transaction: jest.fn(async (callback) => callback(manager)) } as never,
    );

    const saved = await service.recordFulfilment("request-1", {
      method: "manual review",
      result: "identity mismatch",
      verificationStatus: "failed",
    });

    expect(saved.status).toBe("failed");
    expect(saved.lastError).toBe("Fulfilment verification failed: identity mismatch");
    expect(eventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "fulfilment.failed" }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "privacy.request.fulfilment_failed" }),
      manager,
    );
  });
});
