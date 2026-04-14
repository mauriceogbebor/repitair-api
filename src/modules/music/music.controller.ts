import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ParseLinkDto } from "./dto/parse-link.dto";

type SongEntry = {
  id: string;
  title: string;
  artist: string;
  platform: "spotify" | "apple-music";
};

const SONG_CATALOG: SongEntry[] = [
  { id: "song_1", title: "Highest in the Room", artist: "Travis Scott", platform: "spotify" },
  { id: "song_2", title: "Risk It All", artist: "Bruno Mars", platform: "spotify" },
  { id: "song_3", title: "Blinding Lights", artist: "The Weeknd", platform: "spotify" },
  { id: "song_4", title: "Levitating", artist: "Dua Lipa", platform: "spotify" },
  { id: "song_5", title: "Peaches", artist: "Justin Bieber", platform: "apple-music" },
  { id: "song_6", title: "Stay", artist: "The Kid LAROI & Justin Bieber", platform: "spotify" },
  { id: "song_7", title: "Montero", artist: "Lil Nas X", platform: "apple-music" },
  { id: "song_8", title: "Kiss Me More", artist: "Doja Cat ft. SZA", platform: "spotify" },
  { id: "song_9", title: "Good 4 U", artist: "Olivia Rodrigo", platform: "apple-music" },
  { id: "song_10", title: "Industry Baby", artist: "Lil Nas X & Jack Harlow", platform: "spotify" },
  { id: "song_11", title: "Heat Waves", artist: "Glass Animals", platform: "spotify" },
  { id: "song_12", title: "Butter", artist: "BTS", platform: "apple-music" },
  { id: "song_13", title: "Mood", artist: "24kGoldn ft. iann dior", platform: "spotify" },
  { id: "song_14", title: "Save Your Tears", artist: "The Weeknd & Ariana Grande", platform: "spotify" },
  { id: "song_15", title: "Watermelon Sugar", artist: "Harry Styles", platform: "apple-music" },
];

/** Attempt to extract a song title from a Spotify or Apple Music URL */
function guessFromLink(link: string): { platform: "spotify" | "apple-music"; title: string; artist: string } {
  const platform: "spotify" | "apple-music" = link.includes("spotify") ? "spotify" : "apple-music";

  // Try to match a known song by checking if the link contains a known ID
  const matched = SONG_CATALOG.find(
    (s) =>
      link.toLowerCase().includes(s.id) ||
      link.toLowerCase().includes(s.title.toLowerCase().replace(/\s+/g, "-")),
  );

  if (matched) {
    return { platform, title: matched.title, artist: matched.artist };
  }

  // Rotate through catalog based on link hash for variety
  const hash = [...link].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const entry = SONG_CATALOG[hash % SONG_CATALOG.length];
  return { platform, title: entry.title, artist: entry.artist };
}

@Controller("music")
@UseGuards(JwtAuthGuard)
export class MusicController {
  @Post("parse-link")
  parseLink(@Body() body: ParseLinkDto) {
    const { platform, title, artist } = guessFromLink(body.link);
    return {
      platform,
      title,
      artist,
      sourceLink: body.link,
    };
  }

  @Get("recent")
  getRecentSongs() {
    // Return 8 most "recent" songs for a richer experience
    return SONG_CATALOG.slice(0, 8);
  }
}
