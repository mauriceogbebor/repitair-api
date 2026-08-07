/**
 * Media-processing PURPOSE — ownership of a processing job / derivative.
 *
 * Introduced for Ice Girl's dual-photo flow: the same source photo may feed two
 * INDEPENDENT slots (the full-scene canvas subject and the Ice Girl widget
 * subject). Purpose is the explicit ownership tag threaded through the contract.
 *
 * Backward compatibility is absolute: every existing caller and every existing
 * derivative is `canvasSubject`, and the content-address key for `canvasSubject`
 * is byte-identical to the legacy key (checksum + kind + version) — so existing
 * reuse and cost behaviour are unchanged. Only a non-default purpose partitions.
 */
export const MEDIA_PROCESSING_PURPOSES = ["canvasSubject", "iceGirlWidgetSubject"] as const;
export type MediaProcessingPurpose = (typeof MEDIA_PROCESSING_PURPOSES)[number];

export const DEFAULT_MEDIA_PROCESSING_PURPOSE: MediaProcessingPurpose = "canvasSubject";

/** Coerce any input into a valid purpose; unknown / missing → the default. */
export function normalizeMediaProcessingPurpose(value: unknown): MediaProcessingPurpose {
  return MEDIA_PROCESSING_PURPOSES.includes(value as MediaProcessingPurpose)
    ? (value as MediaProcessingPurpose)
    : DEFAULT_MEDIA_PROCESSING_PURPOSE;
}

/**
 * Content-address key for derivative reuse/dedupe, scoped by purpose.
 *
 * `canvasSubject` yields the LEGACY key (no suffix) so existing content-addressed
 * reuse is preserved exactly. A non-default purpose appends a namespace so the
 * same source under a different purpose can never collide with the canvas cache.
 */
export function derivativeContentKey(
  sourceChecksum: string,
  kind: string,
  providerVersion: string,
  purpose: MediaProcessingPurpose = DEFAULT_MEDIA_PROCESSING_PURPOSE,
): string {
  const base = `${sourceChecksum}:${kind}:${providerVersion}`;
  return purpose === DEFAULT_MEDIA_PROCESSING_PURPOSE ? base : `${base}:${purpose}`;
}
