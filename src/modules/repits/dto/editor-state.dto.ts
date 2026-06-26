import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";

const MAX_EDITOR_STATE_SIZE = 512 * 1024; // 512 KB — generous but prevents abuse

@ValidatorConstraint({ name: "isValidEditorState", async: false })
class IsValidEditorStateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments): boolean {
    if (value === null || value === undefined) return true; // @IsOptional handles this
    if (typeof value !== "object" || Array.isArray(value)) return false;

    // Check serialized size to prevent oversized payloads
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length > MAX_EDITOR_STATE_SIZE) return false;
    } catch {
      return false;
    }

    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return `editorState must be a valid JSON object under ${MAX_EDITOR_STATE_SIZE / 1024}KB`;
  }
}

/**
 * Validates that `editorState` is a well-formed JSON object within size limits.
 * Deep structure validation is intentionally omitted because:
 * - The shape varies by template and evolves with the frontend
 * - The data is only consumed by the frontend client
 * - The composition field (which controls rendering) already has deep validation
 */
export function IsValidEditorState(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidEditorStateConstraint,
    });
  };
}
