import { registerDecorator, type ValidationOptions } from "class-validator";
import { isSupportedSpotlightSongLink } from "../../spotlight/spotlight-song-link";

export { isSupportedSpotlightSongLink } from "../../spotlight/spotlight-song-link";

export function IsSupportedSpotlightSongLink(validationOptions?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: "isSupportedSpotlightSongLink",
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === "string" && isSupportedSpotlightSongLink(value);
        },
      },
    });
  };
}
