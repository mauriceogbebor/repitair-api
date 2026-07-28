import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

export interface BackgroundRemovalInput {
  buffer: Buffer;
  mimeType: string;
}

export interface BackgroundRemovalOutput {
  buffer: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  /** Upstream request id (recorded for provenance + support), where the provider returns one. */
  providerRequestId?: string | null;
  /** Upstream HTTP status of the successful call (diagnostics). */
  upstreamStatus?: number | null;
  /** Provider-reported credits/units consumed by this call (cost accounting). */
  creditsCharged?: number | null;
}

/**
 * Provider abstraction for background removal. Templates NEVER see this — only
 * the pipeline does. New providers (RMBG, U²-Net, in-house model) implement this
 * interface and are selected by configuration, so no code couples to a vendor.
 */
export interface BackgroundRemovalProvider {
  /** Stable provider id, recorded on each derivative for provenance + analytics. */
  readonly name: string;
  /** Provider/model version. Bumping it invalidates the cache and triggers regen. */
  readonly version: string;
  removeBackground(input: BackgroundRemovalInput): Promise<BackgroundRemovalOutput>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, missing: string) {
    super(`Background-removal provider "${provider}" is not configured (missing ${missing}).`);
    this.name = "ProviderNotConfiguredError";
  }
}

/**
 * Raised when the upstream provider does not answer within the deadline. The
 * worker classifies this as `media.provider_timeout` (distinct from a request
 * error) so operators can tell a slow/unreachable provider from a rejected call.
 */
export class ProviderTimeoutError extends Error {
  constructor(provider: string, timeoutMs: number) {
    super(`Background-removal provider "${provider}" timed out after ${timeoutMs}ms.`);
    this.name = "ProviderTimeoutError";
  }
}

/**
 * Raised when the upstream provider answers with an error status. Carries the
 * status so the worker can distinguish rate-limiting (429) from other failures.
 */
export class ProviderRequestError extends Error {
  constructor(provider: string, readonly status: number, detail?: string) {
    super(`Background-removal provider "${provider}" failed: ${status}${detail ? ` ${detail}` : ""}`.trim());
    this.name = "ProviderRequestError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Run a fetch with an abortable deadline, mapping an abort to a typed timeout error. */
async function fetchWithTimeout(provider: string, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new ProviderTimeoutError(provider, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toNumberOrNull(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Development/stub provider. Performs NO external call and returns the source
 * bytes labelled as a PNG. It exists so the full asynchronous pipeline can run
 * end-to-end without external credentials; it is never selected in production
 * (the factory refuses to default to it when NODE_ENV=production).
 */
export class StubBackgroundRemovalProvider implements BackgroundRemovalProvider {
  readonly name = "stub";
  readonly version = "stub-v0";
  async removeBackground(input: BackgroundRemovalInput): Promise<BackgroundRemovalOutput> {
    return { buffer: input.buffer, mimeType: "image/png", providerRequestId: null, upstreamStatus: null, creditsCharged: 0 };
  }
}

/** remove.bg HTTP adapter (config-driven; requires REMOVE_BG_API_KEY). */
export class RemoveBgProvider implements BackgroundRemovalProvider {
  readonly name = "remove_bg";
  readonly version = "remove_bg-v1";
  constructor(private readonly apiKey: string, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}
  async removeBackground(input: BackgroundRemovalInput): Promise<BackgroundRemovalOutput> {
    const form = new FormData();
    form.append("size", "auto");
    form.append("image_file", new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), "source");
    const response = await fetchWithTimeout(this.name, "https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey },
      body: form,
    }, this.timeoutMs);
    if (!response.ok) {
      throw new ProviderRequestError(this.name, response.status, await response.text().catch(() => ""));
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: "image/png",
      width: toNumberOrNull(response.headers.get("x-width")) ?? undefined,
      height: toNumberOrNull(response.headers.get("x-height")) ?? undefined,
      providerRequestId: response.headers.get("x-request-id"),
      upstreamStatus: response.status,
      creditsCharged: toNumberOrNull(response.headers.get("x-credits-charged")),
    };
  }
}

/** Clipdrop HTTP adapter (config-driven; requires CLIPDROP_API_KEY). */
export class ClipdropProvider implements BackgroundRemovalProvider {
  readonly name = "clipdrop";
  readonly version = "clipdrop-v1";
  constructor(private readonly apiKey: string, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}
  async removeBackground(input: BackgroundRemovalInput): Promise<BackgroundRemovalOutput> {
    const form = new FormData();
    form.append("image_file", new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), "source");
    const response = await fetchWithTimeout(this.name, "https://clipdrop-api.co/remove-background/v1", {
      method: "POST",
      headers: { "x-api-key": this.apiKey },
      body: form,
    }, this.timeoutMs);
    if (!response.ok) {
      throw new ProviderRequestError(this.name, response.status, await response.text().catch(() => ""));
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: "image/png",
      providerRequestId: response.headers.get("x-request-id"),
      upstreamStatus: response.status,
      creditsCharged: toNumberOrNull(response.headers.get("x-remaining-credits")) != null ? 1 : null,
    };
  }
}

/**
 * Normalise the configured provider id. Operators may spell remove.bg several
 * ways (the directive uses `removebg`); all canonicalise to the same adapter so a
 * config typo can never silently fall back to the stub.
 */
export function normalizeProviderId(raw?: string | null): string {
  const value = (raw ?? "stub").trim().toLowerCase().replace(/[.\s-]/g, "_");
  const aliases: Record<string, string> = {
    removebg: "remove_bg",
    remove_bg: "remove_bg",
    clipdrop: "clipdrop",
    clip_drop: "clipdrop",
    stub: "stub",
    none: "stub",
  };
  return aliases[value] ?? value;
}

/**
 * Configuration-driven selection. BG_REMOVAL_PROVIDER chooses the implementation;
 * production must not fall back to the stub.
 */
export function createBackgroundRemovalProvider(config: Pick<ConfigService, "get">): BackgroundRemovalProvider {
  const selected = normalizeProviderId(config.get<string>("BG_REMOVAL_PROVIDER"));
  const isProduction = config.get<string>("NODE_ENV") === "production";
  const timeoutMs = Number(config.get<string>("BG_REMOVAL_TIMEOUT_MS")) || DEFAULT_TIMEOUT_MS;
  switch (selected) {
    case "remove_bg": {
      const key = config.get<string>("REMOVE_BG_API_KEY");
      if (!key) throw new ProviderNotConfiguredError("remove_bg", "REMOVE_BG_API_KEY");
      return new RemoveBgProvider(key, timeoutMs);
    }
    case "clipdrop": {
      const key = config.get<string>("CLIPDROP_API_KEY");
      if (!key) throw new ProviderNotConfiguredError("clipdrop", "CLIPDROP_API_KEY");
      return new ClipdropProvider(key, timeoutMs);
    }
    case "stub":
    default: {
      if (isProduction) {
        throw new Error("BG_REMOVAL_PROVIDER=stub is not permitted in production. Configure removebg (remove.bg) or clipdrop (or an in-house provider).");
      }
      Logger.warn("BG_REMOVAL_PROVIDER=stub — background removal returns the source bytes. Development only.", "BackgroundRemovalProvider");
      return new StubBackgroundRemovalProvider();
    }
  }
}

export const BACKGROUND_REMOVAL_PROVIDER = Symbol("BACKGROUND_REMOVAL_PROVIDER");
