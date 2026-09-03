export const SPOTLIGHT_CREATE_DESTINATION = "/create/pick-template?fresh=1";

export function isSupportedSpotlightDestination(value: string) {
  return value.trim() === SPOTLIGHT_CREATE_DESTINATION;
}
