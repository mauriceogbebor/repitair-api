import { describe, expect, it } from "@jest/globals";
import { resolveCorsOrigins } from "./cors-origins";

describe("resolveCorsOrigins", () => {
  it("keeps configured clients and adds the API self-origin", () => {
    expect(
      resolveCorsOrigins({
        CORS_ORIGINS: "https://admin-staging.repitair.com",
        PUBLIC_URL: "https://api-staging.repitair.com",
        API_BASE_URL: "https://api-staging.repitair.com/api",
        APPLE_MUSIC_AUTH_BASE_URL: "https://api-staging.repitair.com",
      }),
    ).toEqual([
      "https://admin-staging.repitair.com",
      "https://api-staging.repitair.com",
    ]);
  });

  it("normalizes URL paths and ignores invalid entries", () => {
    expect(
      resolveCorsOrigins({
        CORS_ORIGINS:
          "https://admin.repitair.com/path,not-a-url,http://localhost:3002",
      }),
    ).toEqual(["https://admin.repitair.com", "http://localhost:3002"]);
  });
});
