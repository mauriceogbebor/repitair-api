export type SpotlightSongProvider = "spotify" | "apple-music";

export function resolveSpotlightSongProvider(
  value: string | null | undefined,
): SpotlightSongProvider | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      host === "open.spotify.com"
      && /^\/(?:intl-[^/]+\/)?track\/[^/]+\/?$/.test(url.pathname)
    ) {
      return "spotify";
    }

    if (
      host === "music.apple.com"
      && (
        url.pathname.includes("/song/")
        || (url.pathname.includes("/album/") && Boolean(url.searchParams.get("i")))
      )
    ) {
      return "apple-music";
    }
  } catch {
    return null;
  }

  return null;
}

export function isSupportedSpotlightSongLink(value: string | null | undefined) {
  return resolveSpotlightSongProvider(value) !== null;
}
