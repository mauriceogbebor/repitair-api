import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync, type ValidationError } from "class-validator";

import { CreateRepitDto } from "./create-repit.dto";
import { UpdateRepitDto } from "./update-repit.dto";

const selectedSong = {
  songLink: "https://open.spotify.com/track/example",
  songTitle: "A Song",
  artistName: "An Artist",
  platform: "spotify",
  durationMs: 180_000,
  albumArtUrl: "https://example.com/artwork.jpg",
};

function validateDto<T extends object>(
  dto: new () => T,
  payload: Record<string, unknown>,
): ValidationError[] {
  return validateSync(plainToInstance(dto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe("Repit selected-song presentation validation", () => {
  it.each([true, false, null])(
    "accepts isExplicit=%p for create and update payloads",
    (isExplicit) => {
      const song = { ...selectedSong, isExplicit };

      expect(validateDto(CreateRepitDto, {
        templateId: "audioverse",
        selectedSongs: [song],
      })).toHaveLength(0);
      expect(validateDto(UpdateRepitDto, {
        selectedSongs: [song],
      })).toHaveLength(0);
    },
  );

  it.each([0, 0.5, 1, null])(
    "accepts progressFraction=%p for create and update payloads",
    (progressFraction) => {
      const song = { ...selectedSong, progressFraction };

      expect(validateDto(CreateRepitDto, {
        templateId: "audioverse",
        selectedSongs: [song],
      })).toHaveLength(0);
      expect(validateDto(UpdateRepitDto, {
        selectedSongs: [song],
      })).toHaveLength(0);
    },
  );

  it("rejects invalid explicit and progress metadata", () => {
    const errors = validateDto(CreateRepitDto, {
      templateId: "audioverse",
      selectedSongs: [{
        ...selectedSong,
        isExplicit: "yes",
        progressFraction: 1.1,
      }],
    });

    expect(errors).not.toHaveLength(0);
  });
});
