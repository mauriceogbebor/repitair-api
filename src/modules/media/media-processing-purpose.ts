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
 * Purposes that are INTRINSICALLY subject-isolation jobs, independent of the
 * template's own background capability.
 *
 * The `canvasSubject` purpose (the default) defers entirely to the template
 * capability: a full-bleed template consumes the original, an isolation template
 * consumes the transparent derivative. But some purposes are isolation BY
 * DEFINITION regardless of what the template does with its background — the Ice
 * Girl widget subject is composited over the player, so it always needs its
 * background removed, even though the Ice Girl BACKGROUND is a whole photo that
 * requires no removal. Without this, the template-level flag (false for Ice Girl)
 * would suppress the widget-subject job and the subject would never be isolated.
 *
 * Each isolation purpose is bound to the single template that owns it, so a
 * client cannot force a paid removal job for an unrelated template by attaching
 * an isolation purpose to an arbitrary resolve request.
 */
const ISOLATION_PURPOSE_OWNERS: Readonly<Record<string, string>> = {
  iceGirlWidgetSubject: "ice-girl",
};

/**
 * True when the given purpose intrinsically requires background removal for the
 * given template — i.e. it is an isolation purpose AND the template is the one
 * that owns it. This is OR-ed with the template capability, never replacing it.
 */
export function purposeRequiresBackgroundRemoval(
  purpose: MediaProcessingPurpose,
  templateId: string,
): boolean {
  return ISOLATION_PURPOSE_OWNERS[purpose] === templateId;
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
