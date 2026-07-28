import type { MediaProcessingStatus } from "../../entities/media-asset.entity";

/** Allowed processing-status transitions. Anything else is rejected. */
export const MEDIA_TRANSITIONS: Record<MediaProcessingStatus, MediaProcessingStatus[]> = {
  uploaded: ["queued"],
  queued: ["processing", "cancelled"],
  processing: ["completed", "failed"],
  failed: ["retry_required", "cancelled"],
  retry_required: ["queued", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionMedia(from: MediaProcessingStatus, to: MediaProcessingStatus): boolean {
  return MEDIA_TRANSITIONS[from]?.includes(to) ?? false;
}

/** A status from which processing may be (re)started. */
export function isReprocessable(status: MediaProcessingStatus): boolean {
  return status === "uploaded" || status === "failed" || status === "retry_required";
}
