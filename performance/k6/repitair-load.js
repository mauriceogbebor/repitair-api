import encoding from "k6/encoding";
import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE_URL = (__ENV.BASE_URL || "https://api-staging.repitair.com").replace(/\/$/, "");
const PROFILE = __ENV.PROFILE || "smoke";
const TOKENS = (__ENV.AUTH_TOKENS || "").split(",").map((value) => value.trim()).filter(Boolean);
const ENABLE_UPLOADS = __ENV.ENABLE_UPLOADS === "true";

const profiles = {
  smoke: {
    executor: "constant-vus",
    vus: 5,
    duration: "1m",
  },
  load: {
    executor: "ramping-vus",
    stages: [
      { duration: "2m", target: 200 },
      { duration: "5m", target: 1_000 },
      { duration: "5m", target: 1_000 },
      { duration: "2m", target: 0 },
    ],
  },
  spike: {
    executor: "ramping-vus",
    stages: [
      { duration: "1m", target: 250 },
      { duration: "30s", target: 2_000 },
      { duration: "2m", target: 2_000 },
      { duration: "1m", target: 0 },
    ],
  },
  soak: {
    executor: "constant-vus",
    vus: 500,
    duration: "60m",
  },
};
const peakVus = { smoke: 5, load: 1_000, spike: 2_000, soak: 500 };

if (!profiles[PROFILE]) throw new Error(`Unknown PROFILE=${PROFILE}`);
if (PROFILE !== "smoke" && TOKENS.length === 0) {
  throw new Error(`${PROFILE} requires AUTH_TOKENS so one source IP does not test only the anonymous rate limit`);
}
if (TOKENS.length > 0 && TOKENS.length < peakVus[PROFILE]) {
  throw new Error(`${PROFILE} requires at least ${peakVus[PROFILE]} unique AUTH_TOKENS (received ${TOKENS.length})`);
}
if (ENABLE_UPLOADS && TOKENS.length === 0) {
  throw new Error("ENABLE_UPLOADS=true requires authenticated load-test accounts");
}

export const options = {
  scenarios: { api: profiles[PROFILE] },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800", "p(99)<1500"],
    checks: ["rate>0.99"],
  },
};

function authHeaders() {
  if (!TOKENS.length) return {};
  const token = TOKENS[(__VU - 1) % TOKENS.length];
  return { Authorization: `Bearer ${token}` };
}

function expectStatus(response, expected, label) {
  check(response, { [`${label}: HTTP ${expected}`]: (value) => value.status === expected });
}

export default function () {
  const requestParams = TOKENS.length ? { headers: authHeaders() } : {};
  group("public discovery", () => {
    expectStatus(http.get(`${BASE_URL}/api/health/ready`, {
      ...requestParams,
      tags: { name: "health-ready" },
    }), 200, "readiness");
    expectStatus(http.get(`${BASE_URL}/api/spotlight`, {
      ...requestParams,
      tags: { name: "spotlight-list" },
    }), 200, "spotlight");
  });

  if (TOKENS.length) {
    group("authenticated reads", () => {
      expectStatus(http.get(`${BASE_URL}/api/templates`, {
        ...requestParams,
        tags: { name: "templates-list" },
      }), 200, "templates");
      expectStatus(http.get(`${BASE_URL}/api/repits?limit=20&offset=0`, {
        ...requestParams,
        tags: { name: "repits-list" },
      }), 200, "repits");
    });

    if (ENABLE_UPLOADS && __ITER % 50 === 0) {
      const onePixelPng = encoding.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "std",
      );
      const response = http.post(
        `${BASE_URL}/api/uploads/image`,
        { file: http.file(onePixelPng, `load-${__VU}-${__ITER}.png`, "image/png") },
        { headers: authHeaders(), tags: { name: "image-upload" } },
      );
      expectStatus(response, 201, "image upload");
    }
  }

  // Four requests every six seconds remains below the authenticated 60/minute
  // general budget. Anonymous smoke traffic shares one IP and is paced lower.
  sleep(TOKENS.length ? 6 : 15);
}
