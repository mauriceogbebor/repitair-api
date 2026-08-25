import { registerDecorator, type ValidationOptions } from "class-validator";

const INTERNAL_SPOTLIGHT_DESTINATIONS = [
  "/create/attach-song",
  "/create/pick-template",
  "/music/collections",
  "/settings/music-connections",
  "/(tabs)/activity",
  "/(tabs)/profile",
] as const;

export function isSupportedSpotlightDestination(value: string) {
  const destination = value.trim();
  if (!destination) return false;

  if (destination.startsWith("https://")) {
    try {
      const url = new URL(destination);
      return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  if (/^\/repit\/[^/?#]+(?:\?[^#\s]*)?$/.test(destination)) return true;

  return INTERNAL_SPOTLIGHT_DESTINATIONS.some(
    (route) => destination === route || destination.startsWith(`${route}?`),
  );
}

export function IsSupportedSpotlightDestination(validationOptions?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: "isSupportedSpotlightDestination",
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === "string" && isSupportedSpotlightDestination(value);
        },
      },
    });
  };
}
