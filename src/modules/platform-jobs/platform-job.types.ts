import type { PlatformJob, PlatformJobPriority } from "../../entities/platform-job.entity";

/** Thrown by a handler to signal a PERMANENT failure (no retry → dead-letter). */
export class NonRetryableJobError extends Error {
  constructor(message: string, public readonly code = "non_retryable") {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

export interface JobExecutionContext {
  job: PlatformJob;
  payload: Record<string, unknown>;
  /** Report progress 0–100 (persists progress + heartbeat). */
  reportProgress: (percent: number, currentStep?: string) => Promise<void>;
  /** Keep-alive for long steps (updates heartbeatAt). */
  heartbeat: () => Promise<void>;
}

export type PlatformJobHandler = (ctx: JobExecutionContext) => Promise<Record<string, unknown> | void>;

export interface JobDefinition {
  queue: string;
  domain: string;
  payloadVersion: number;
  maxAttempts: number;
  timeoutMs: number;
  /** Backoff per attempt index (ms). Jitter is applied on top. */
  backoffMs: number[];
  cancellable: boolean;
  reportsProgress: boolean;
  requiredFlag?: string;
  /** Return an error string if the payload is invalid; null if valid. */
  validate?: (payload: Record<string, unknown>) => string | null;
}

const DEFAULT_BACKOFF = [0, 30_000, 120_000, 600_000, 1_800_000];

function requireKeys(keys: string[]) {
  return (payload: Record<string, unknown>): string | null => {
    for (const k of keys) if (payload[k] == null) return `Missing required payload field "${k}"`;
    return null;
  };
}

/**
 * Controlled registry of supported job types. Enqueueing an unknown type is
 * rejected; an invalid payload is rejected before persistence. Handlers are
 * registered at runtime by the owning domain module (see registerHandler).
 */
export const JOB_DEFINITIONS: Record<string, JobDefinition> = {
  "privacy.data_export": { queue: "privacy", domain: "privacy", payloadVersion: 1, maxAttempts: 5, timeoutMs: 120_000, backoffMs: DEFAULT_BACKOFF, cancellable: true, reportsProgress: true, validate: requireKeys(["privacyRequestId"]) },
  "privacy.account_deletion": { queue: "privacy", domain: "privacy", payloadVersion: 1, maxAttempts: 5, timeoutMs: 300_000, backoffMs: DEFAULT_BACKOFF, cancellable: false, reportsProgress: true, validate: requireKeys(["privacyRequestId"]) },
  "notification.campaign_send": { queue: "notifications", domain: "notifications", payloadVersion: 1, maxAttempts: 5, timeoutMs: 300_000, backoffMs: DEFAULT_BACKOFF, cancellable: true, reportsProgress: true, requiredFlag: "push_notifications", validate: requireKeys(["notificationId"]) },
  "notification.receipt_poll": { queue: "notifications", domain: "notifications", payloadVersion: 1, maxAttempts: 8, timeoutMs: 60_000, backoffMs: DEFAULT_BACKOFF, cancellable: false, reportsProgress: false, validate: requireKeys(["notificationId"]) },
  "notification.user_message": { queue: "notifications", domain: "notifications", payloadVersion: 1, maxAttempts: 5, timeoutMs: 60_000, backoffMs: DEFAULT_BACKOFF, cancellable: true, reportsProgress: false, validate: requireKeys(["userId"]) },
  "email.send": { queue: "email", domain: "email", payloadVersion: 1, maxAttempts: 6, timeoutMs: 60_000, backoffMs: DEFAULT_BACKOFF, cancellable: true, reportsProgress: false, validate: requireKeys(["to", "template"]) },
  "spotlight.activate": { queue: "spotlight", domain: "spotlight", payloadVersion: 1, maxAttempts: 4, timeoutMs: 30_000, backoffMs: DEFAULT_BACKOFF, cancellable: true, reportsProgress: false, validate: requireKeys(["spotlightId"]) },
  "spotlight.expire": { queue: "spotlight", domain: "spotlight", payloadVersion: 1, maxAttempts: 4, timeoutMs: 30_000, backoffMs: DEFAULT_BACKOFF, cancellable: true, reportsProgress: false, validate: requireKeys(["spotlightId"]) },
  "analytics.aggregate_daily": { queue: "analytics", domain: "analytics", payloadVersion: 1, maxAttempts: 4, timeoutMs: 120_000, backoffMs: DEFAULT_BACKOFF, cancellable: true, reportsProgress: true },
  "storage.cleanup": { queue: "storage", domain: "storage", payloadVersion: 1, maxAttempts: 4, timeoutMs: 120_000, backoffMs: DEFAULT_BACKOFF, cancellable: true, reportsProgress: true },
  "media.background_remove": { queue: "media", domain: "media", payloadVersion: 1, maxAttempts: 4, timeoutMs: 180_000, backoffMs: DEFAULT_BACKOFF, cancellable: true, reportsProgress: true, validate: requireKeys(["assetId"]) },
};

export function getJobDefinition(type: string): JobDefinition | null {
  return JOB_DEFINITIONS[type] ?? null;
}

export const PRIORITY_RANK: Record<PlatformJobPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/** Retryable error signatures — transient/infrastructural. */
const RETRYABLE_PATTERNS = [/timeout/i, /ETIMEDOUT/, /ECONNRESET/, /ECONNREFUSED/, /EAI_AGAIN/, /socket hang up/i, /temporarily unavailable/i, /rate.?limit/i, /connection terminated/i, /too many connections/i];

export function classifyError(err: unknown): { code: string; retryable: boolean } {
  if (err instanceof NonRetryableJobError) return { code: err.code, retryable: false };
  const message = err instanceof Error ? err.message : String(err);
  const retryable = RETRYABLE_PATTERNS.some((p) => p.test(message));
  return { code: retryable ? "transient" : "error", retryable };
}

/** Exponential backoff with ±20% jitter, capped by the definition's schedule. */
export function computeBackoffMs(attempt: number, def: JobDefinition): number {
  const idx = Math.min(attempt, def.backoffMs.length - 1);
  const base = def.backoffMs[idx];
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}
