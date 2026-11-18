const MAX_STRING_LENGTH = 5000;
const MAX_DESCRIPTION_LENGTH = 2000;

export function sanitizeString(input: unknown, maxLength = MAX_STRING_LENGTH): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return trimmed.substring(0, maxLength);
  return trimmed;
}

export function sanitizeDescription(input: unknown): string | null {
  return sanitizeString(input, MAX_DESCRIPTION_LENGTH);
}

export function sanitizePositiveNumber(input: unknown): number | null {
  if (typeof input === "string") {
    const parsed = Number(input);
    if (isNaN(parsed) || parsed <= 0) return null;
    return parsed;
  }
  if (typeof input !== "number" || isNaN(input) || input <= 0) return null;
  return input;
}

export function sanitizeEnum<T extends string>(input: unknown, allowed: readonly T[]): T | null {
  if (typeof input !== "string") return null;
  const lower = input.toLowerCase().trim();
  const match = allowed.find((v) => v === lower);
  return match ?? null;
}
