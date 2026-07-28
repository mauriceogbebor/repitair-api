import type { TemplateCapabilities } from "../../common/template-metadata/template-metadata.types";

/**
 * Single source of truth for "does this template need subject isolation?".
 * Background removal is a PLATFORM capability declared by templates, not a
 * feature embedded in each template. The backend uses this to decide whether a
 * template consumes the transparent derivative or the original image.
 */
export function templateRequiresBackgroundRemoval(capabilities?: TemplateCapabilities | null): boolean {
  return Boolean(capabilities?.requiresBackgroundRemoval);
}

/**
 * Reference classification of current templates (Workstream 18). Future templates
 * declare `requiresBackgroundRemoval` in their capabilities instead of embedding
 * processing logic; this map documents the V1 rollout intent.
 */
export const TEMPLATE_BACKGROUND_REMOVAL_CLASSIFICATION: Record<string, boolean> = {
  "matcha-mood": false,
  "echo-room": false,
  "midnight-mood": false,
  "air-wave": false,
  "ice-girl": false,
  "pink-replay": false,
  // Future subject-isolation templates (declare true when introduced):
  "floating-subject": true,
  "split-portrait": true,
  "layered-collage": true,
};
