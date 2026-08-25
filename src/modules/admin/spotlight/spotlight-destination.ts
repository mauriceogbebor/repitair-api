import { registerDecorator, type ValidationOptions } from "class-validator";
import { isSupportedSpotlightDestination } from "../../spotlight/spotlight-destination";

export { isSupportedSpotlightDestination, SPOTLIGHT_CREATE_DESTINATION } from "../../spotlight/spotlight-destination";

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
