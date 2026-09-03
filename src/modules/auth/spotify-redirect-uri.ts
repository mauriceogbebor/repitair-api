/**
 * Validation for the Spotify OAuth redirect URI.
 *
 * `redirect_uri` is a SINGLE URL per OAuth request and must be byte-identical
 * between the authorize call and the token exchange. A comma-separated list (a
 * common env mistake — multiple allowed URIs belong in the Spotify developer
 * dashboard, not this env var), a non-https scheme, a wrong path, or a stray
 * query/fragment all get forwarded verbatim and produce Spotify's opaque
 * "redirect_uri: Not matching configuration". This turns that into a precise,
 * actionable message surfaced at startup, in diagnostics, and on connect.
 */

export const SPOTIFY_CALLBACK_PATH = "/api/auth/spotify/callback";

/**
 * Returns a human-readable problem string if the configured redirect URI is
 * unusable, or `null` when it is valid.
 */
export function spotifyRedirectUriProblem(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) {
    return "SPOTIFY_REDIRECT_URI is not set.";
  }
  const value = raw.trim();
  if (value.includes(",")) {
    return "SPOTIFY_REDIRECT_URI must be a single URL, not a comma-separated list. Register additional redirect URIs in the Spotify developer dashboard, not this env var.";
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `SPOTIFY_REDIRECT_URI is not a valid URL: "${value}".`;
  }

  const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLoopback && parsed.protocol === "http:")) {
    return "SPOTIFY_REDIRECT_URI must use https (http is only allowed for localhost).";
  }
  if (parsed.pathname !== SPOTIFY_CALLBACK_PATH) {
    return `SPOTIFY_REDIRECT_URI path must be exactly ${SPOTIFY_CALLBACK_PATH} (got "${parsed.pathname}").`;
  }
  if (parsed.search || parsed.hash) {
    return "SPOTIFY_REDIRECT_URI must not contain a query string or fragment.";
  }
  return null;
}
