import { Logger } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";

import { BaseRateLimiter } from "./base-rate-limit";

class TestRateLimiter extends BaseRateLimiter {
  constructor(redis: any | null) {
    super(
      {
        windowMs: 60_000,
        maxRequests: 10,
        message: "Too many requests",
      },
      redis,
    );
  }

  use(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.check(req, res, next);
  }
}

describe("BaseRateLimiter Redis availability", () => {
  const request = {
    ip: "127.0.0.1",
    ips: [],
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;

  function response(): Response {
    return { setHeader: jest.fn() } as unknown as Response;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not issue commands to a closed Redis client", async () => {
    const redis = {
      status: "end",
      incr: jest.fn(),
      pexpire: jest.fn(),
      pttl: jest.fn(),
    };
    const limiter = new TestRateLimiter(redis);
    const next = jest.fn();

    await limiter.use(request, response(), next);

    expect(redis.incr).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    limiter.onModuleDestroy();
  });

  it("uses Redis when the client is ready", async () => {
    const redis = {
      status: "ready",
      incr: jest.fn().mockResolvedValue(1),
      pexpire: jest.fn().mockResolvedValue(1),
      pttl: jest.fn().mockResolvedValue(60_000),
    };
    const limiter = new TestRateLimiter(redis);
    const next = jest.fn();

    await limiter.use(request, response(), next);

    expect(redis.incr).toHaveBeenCalledTimes(1);
    expect(redis.pexpire).toHaveBeenCalledTimes(1);
    expect(redis.pttl).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    limiter.onModuleDestroy();
  });

  it("logs a command failure once while requests use the fallback", async () => {
    const redis = {
      status: "ready",
      incr: jest.fn().mockRejectedValue(new Error("connection lost")),
    };
    const logError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const limiter = new TestRateLimiter(redis);

    await limiter.use(request, response(), jest.fn());
    await limiter.use(request, response(), jest.fn());

    expect(logError).toHaveBeenCalledTimes(1);
    limiter.onModuleDestroy();
  });
});
