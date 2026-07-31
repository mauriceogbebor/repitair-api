import { Injectable } from "@nestjs/common";
import type { MediaAsset } from "../../entities/media-asset.entity";
import type { MediaDerivative, MediaDerivativeKind } from "../../entities/media-derivative.entity";

export type MediaProcessorContext = {
  jobId?: string | null;
  correlationId?: string | null;
};

/**
 * A single, independently pluggable pipeline stage. Background removal is the
 * only stage today; enhancement, relighting, shadow generation, compression and
 * thumbnailing implement the same interface and register here — the pipeline
 * never needs redesign to add a capability (Workstream 14).
 */
export interface MediaProcessor {
  /** Stable stage id (e.g. "background_removal"). */
  readonly stage: string;
  /** The derivative kind this stage produces. */
  readonly produces: MediaDerivativeKind;
  /** Ordering hint — lower runs first. */
  readonly order: number;
  /** Produce (or reuse) the derivative for the asset. Owns its own caching. */
  process(asset: MediaAsset, context?: MediaProcessorContext): Promise<MediaDerivative>;
}

/**
 * Ordered registry of pipeline stages. Stages are registered at module init and
 * consumed by the pipeline in `order`. Keeping this generic is what makes the
 * pipeline reusable for future AI features without touching templates.
 */
@Injectable()
export class MediaProcessorRegistry {
  private readonly processors = new Map<string, MediaProcessor>();

  register(processor: MediaProcessor): void {
    this.processors.set(processor.stage, processor);
  }

  get(stage: string): MediaProcessor | null {
    return this.processors.get(stage) ?? null;
  }

  /** All registered stages in execution order. */
  ordered(): MediaProcessor[] {
    return [...this.processors.values()].sort((a, b) => a.order - b.order);
  }

  has(stage: string): boolean {
    return this.processors.has(stage);
  }
}
