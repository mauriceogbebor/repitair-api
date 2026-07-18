import { isRedisReady } from "./redis.module";

describe("isRedisReady", () => {
  it.each(["wait", "connecting", "connect", "reconnecting", "close", "end"])(
    "returns false while Redis status is %s",
    (status) => {
      expect(isRedisReady({ status })).toBe(false);
    },
  );

  it("returns true when Redis is ready", () => {
    expect(isRedisReady({ status: "ready" })).toBe(true);
  });

  it("supports status-less test doubles", () => {
    expect(isRedisReady({ get: jest.fn() })).toBe(true);
  });

  it("returns false when Redis is not configured", () => {
    expect(isRedisReady(null)).toBe(false);
  });
});
