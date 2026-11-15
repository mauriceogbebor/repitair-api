import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const LRCLIB_BASE = "https://lrclib.net/api";
const UPSTREAM_TIMEOUT_MS = 8000;

export type LyricsResult = {
  trackName: string;
  artistName: string;
  albumName: string | null;
  plainLyrics: string;
  lines: string[];
};

type LrclibSearchResult = {
  trackName: string;
  artistName: string;
  albumName: string | null;
  plainLyrics: string | null;
  instrumental: boolean;
};

/**
 * Server-side proxy for LRCLIB lyrics lookups.
 *
 * The client used to call LRCLIB directly. Routing it through the backend gives
 * us a single server-side kill switch (`LYRICS_ENABLED`) so lyrics can be turned
 * off without an app release, plus one place to add caching, attribution, or a
 * licensed provider later. LRCLIB is a community database, not a licence — treat
 * this as a mitigation, not a clearance.
 */
@Injectable()
export class LyricsService {
  private readonly logger = new Logger(LyricsService.name);

  constructor(private readonly config: ConfigService) {}

  /** Lyrics stay on unless explicitly disabled, so the kill switch is opt-out. */
  isEnabled(): boolean {
    const raw = this.config.get<string>("LYRICS_ENABLED", "true") ?? "true";
    return raw.trim().toLowerCase() !== "false";
  }

  async search(title: string, artist: string): Promise<LyricsResult | null> {
    if (!this.isEnabled()) return null;

    const params = new URLSearchParams({
      track_name: title.trim(),
      artist_name: artist.trim(),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(`${LRCLIB_BASE}/search?${params.toString()}`, {
        headers: { "User-Agent": "Repitair/1.0 (https://repitair.com)" },
        signal: controller.signal,
      });
      if (!response.ok) return null;

      const results = (await response.json()) as LrclibSearchResult[];
      const match = Array.isArray(results)
        ? results.find((r) => !r.instrumental && r.plainLyrics)
        : undefined;
      if (!match || !match.plainLyrics) return null;

      const lines = match.plainLyrics
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      return {
        trackName: match.trackName,
        artistName: match.artistName,
        albumName: match.albumName ?? null,
        plainLyrics: match.plainLyrics,
        lines,
      };
    } catch (error) {
      this.logger.warn(
        `Lyrics lookup failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
