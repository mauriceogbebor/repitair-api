import { PlatformJobsService } from "./platform-jobs.service";

function makeService() {
  const jobs = {
    count: jest.fn(),
    findOne: jest.fn(),
  };
  const heartbeats = {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (value) => value),
    update: jest.fn(),
  };
  const service = new PlatformJobsService(
    jobs as never,
    heartbeats as never,
    {} as never,
    {} as never,
  );
  return { heartbeats, jobs, service };
}

describe("PlatformJobsService worker health", () => {
  it("registers a durable worker heartbeat without exposing configuration secrets", async () => {
    const { heartbeats, service } = makeService();
    heartbeats.findOne.mockResolvedValue(null);

    await service.registerWorker({
      workerId: "worker-abc",
      queues: ["media"],
      environment: "staging",
      revision: "sha123",
      provider: "remove_bg",
      storageProvider: "s3",
    });

    expect(heartbeats.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "worker-abc",
      queues: ["media"],
      provider: "remove_bg",
      state: "running",
    }));
  });

  it("reports an alive worker and authoritative queue lag", async () => {
    const { heartbeats, jobs, service } = makeService();
    const now = Date.now();
    heartbeats.find.mockResolvedValue([{
      id: "worker-abc",
      state: "running",
      queues: ["media"],
      heartbeatAt: new Date(now - 5_000),
      startedAt: new Date(now - 60_000),
    }]);
    jobs.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    jobs.findOne.mockResolvedValue({
      queuedAt: new Date(now - 90_000),
      createdAt: new Date(now - 90_000),
    });

    const result = await service.workerHealth();

    expect(result.status).toBe("healthy");
    expect(result.activeWorkerCount).toBe(1);
    expect(result.queuedCount).toBe(2);
    expect(result.runningCount).toBe(1);
    expect(result.oldestQueueAgeMs).toBeGreaterThanOrEqual(89_000);
  });

  it("reports critical when work is queued and no worker heartbeat is alive", async () => {
    const { heartbeats, jobs, service } = makeService();
    heartbeats.find.mockResolvedValue([]);
    jobs.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    jobs.findOne.mockResolvedValue({ queuedAt: new Date(), createdAt: new Date() });

    const result = await service.workerHealth();

    expect(result.status).toBe("critical");
    expect(result.activeWorkerCount).toBe(0);
  });
});
