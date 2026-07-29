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

/** Does the composition declare an isolated foreground-subject treatment? */
export function templateSupportsIsolatedSubject(capabilities?: TemplateCapabilities | null): boolean {
  return Boolean(capabilities?.supportsIsolatedSubject);
}

/**
 * The isolation-capability invariant: a template may only require background
 * removal if its composition declares it renders an isolated subject. This is
 * the guardrail that prevents an operator enabling AI processing on a full-bleed
 * template (which would incur provider cost with no design benefit). Returns an
 * error message when inconsistent, or null when valid.
 */
export function isolationCapabilityError(capabilities?: TemplateCapabilities | null): string | null {
  const requires = templateRequiresBackgroundRemoval(capabilities);
  const supports = templateSupportsIsolatedSubject(capabilities);
  if (requires && !supports) {
    return "requiresBackgroundRemoval can only be enabled when the composition declares supportsIsolatedSubject: true (an isolated foreground-subject composition). Certify the composition first.";
  }
  return null;
}
