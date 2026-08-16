import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { SUPPORT_STATUS_TRANSITIONS } from "./support-lifecycle.constants";

/**
 * Cross-repository parity guard.
 *
 * repitair-admin/lib/support-lifecycle.ts keeps a hand-maintained copy of the
 * backend's canonical transition table so the admin status dialog never offers
 * an invalid destination. Historically nothing detected drift between the two.
 * This test reads the admin mirror and asserts it is byte-for-value identical to
 * the backend authority, so any divergence fails the backend suite in CI.
 *
 * When the admin repo is not checked out alongside the backend (e.g. an isolated
 * package build) the mirror is absent — the assertion is skipped rather than
 * failing, since there is nothing to compare against.
 */
const ADMIN_MIRROR = resolve(
  __dirname,
  "../../../../../repitair-admin/lib/support-lifecycle.ts",
);

/** Extract the `SUPPORT_STATUS_TRANSITIONS = { ... }` literal from the mirror. */
function parseMirrorTransitions(source: string): Record<string, string[]> {
  const marker = "SUPPORT_STATUS_TRANSITIONS";
  const start = source.indexOf("{", source.indexOf(marker));
  if (start === -1) {
    throw new Error("Could not locate SUPPORT_STATUS_TRANSITIONS literal in admin mirror");
  }
  let depth = 0;
  let end = -1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error("Unterminated SUPPORT_STATUS_TRANSITIONS literal in admin mirror");
  }
  const literal = source.slice(start, end + 1);
  // Object literal with unquoted identifier keys + double-quoted string arrays:
  // valid JS, safe to evaluate in the test (trusted in-repo source).
  // eslint-disable-next-line no-eval
  return eval(`(${literal})`) as Record<string, string[]>;
}

const maybe = existsSync(ADMIN_MIRROR) ? describe : describe.skip;

maybe("support lifecycle admin parity", () => {
  it("admin mirror matches the backend canonical transition table exactly", () => {
    const mirror = parseMirrorTransitions(readFileSync(ADMIN_MIRROR, "utf8"));
    expect(mirror).toEqual(SUPPORT_STATUS_TRANSITIONS);
  });
});
