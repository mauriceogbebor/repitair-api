/**
 * Shared branded HTML shell for all Repitair transactional emails.
 *
 * Mail clients strip <style> blocks, CSS variables, and external CSS, so
 * everything here is inline hex on a table layout. Colours mirror the admin
 * dark theme (charcoal surfaces, neon-green action). All caller-supplied text
 * is HTML-escaped inside this module — callers pass PLAIN strings.
 */

const COLORS = {
  bg: "#0e0f12",
  surface: "#141619",
  border: "#23262b",
  textPrimary: "#f2f4f6",
  textSecondary: "#a7adb5",
  textMuted: "#6b7178",
  textFaint: "#4b5158",
  primary: "#17cf59",
  neon: "#1df166",
  onPrimary: "#08090b",
};

export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BrandedEmailOptions {
  /** Hidden preview text shown in the inbox list (plain text). */
  preheader: string;
  /** Large headline (plain text). */
  heading: string;
  /** One or more body paragraphs (plain text). */
  intro: string | string[];
  /** Optional large monospaced code block (verification / reset codes). */
  code?: string;
  /** Optional primary action button. */
  cta?: { label: string; url: string };
  /** Optional copy/paste fallback link shown under the button. */
  fallbackUrl?: string;
  /** Optional small muted note (expiry, safety guidance). */
  note?: string;
  /**
   * Logo image URL. Falls back to EMAIL_LOGO_URL, then the admin brand asset at
   * ADMIN_FRONTEND_ORIGIN, then a text wordmark. Must be reachable over HTTPS
   * and legible on a dark background.
   */
  logoUrl?: string | null;
}

function resolveLogoUrl(explicit?: string | null): string | null {
  if (explicit) return explicit;
  const fromEnv = process.env.EMAIL_LOGO_URL?.trim();
  if (fromEnv) return fromEnv;
  const adminOrigin = process.env.ADMIN_FRONTEND_ORIGIN?.trim();
  if (adminOrigin) return `${adminOrigin.replace(/\/$/, "")}/brand/repitair-logo.png`;
  return null;
}

function renderHeader(logoUrl: string | null): string {
  if (logoUrl) {
    return `<img src="${escapeHtml(logoUrl)}" alt="Repitair" height="28" style="height:28px;width:auto;display:block;border:0;outline:none;text-decoration:none;" />`;
  }
  // Text wordmark fallback — always legible, never a broken image.
  return `<span style="display:inline-block;font-size:16px;font-weight:700;letter-spacing:-0.01em;color:${COLORS.textPrimary};">
    <span style="display:inline-block;width:9px;height:9px;background-color:${COLORS.neon};border-radius:9999px;vertical-align:middle;margin-right:8px;"></span>Repitair
  </span>`;
}

export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const logoUrl = resolveLogoUrl(opts.logoUrl);
  const paragraphs = (Array.isArray(opts.intro) ? opts.intro : [opts.intro])
    .map(
      (p) =>
        `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:${COLORS.textSecondary};">${escapeHtml(p)}</p>`,
    )
    .join("");

  const codeBlock = opts.code
    ? `<div style="background-color:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:12px;padding:20px;text-align:center;margin:8px 0 4px 0;">
         <span style="font-size:30px;font-weight:700;letter-spacing:8px;color:${COLORS.textPrimary};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(opts.code)}</span>
       </div>`
    : "";

  const ctaBlock = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px 0;">
         <tr>
           <td style="border-radius:10px;background-color:${COLORS.primary};">
             <a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:${COLORS.onPrimary};text-decoration:none;border-radius:10px;">${escapeHtml(opts.cta.label)}</a>
           </td>
         </tr>
       </table>`
    : "";

  const fallbackBlock = opts.fallbackUrl
    ? `<p style="margin:12px 0 0 0;font-size:12px;line-height:1.5;color:${COLORS.textMuted};">If the button doesn't work, paste this link into your browser:</p>
       <p style="margin:6px 0 0 0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(opts.fallbackUrl)}" style="color:${COLORS.primary};text-decoration:none;">${escapeHtml(opts.fallbackUrl)}</a></p>`
    : "";

  const noteBlock = opts.note
    ? `<p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:${COLORS.textMuted};">${escapeHtml(opts.note)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>Repitair</title>
  </head>
  <body style="margin:0;padding:0;background-color:${COLORS.bg};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${COLORS.bg};font-size:1px;line-height:1px;">${escapeHtml(opts.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;">
            <tr><td style="padding:32px 32px 0 32px;">${renderHeader(logoUrl)}</td></tr>
            <tr><td style="padding:20px 32px 0 32px;"><h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:600;color:${COLORS.textPrimary};letter-spacing:-0.01em;">${escapeHtml(opts.heading)}</h1></td></tr>
            <tr><td style="padding:16px 32px 0 32px;">${paragraphs}</td></tr>
            ${codeBlock || ctaBlock ? `<tr><td style="padding:12px 32px 0 32px;">${codeBlock}${ctaBlock}${fallbackBlock}</td></tr>` : ""}
            ${noteBlock ? `<tr><td style="padding:0 32px;">${noteBlock}</td></tr>` : ""}
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <hr style="border:none;border-top:1px solid ${COLORS.border};margin:16px 0;" />
                <p style="margin:0;font-size:12px;color:${COLORS.textFaint};">Repitair — Share your music, your way.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
