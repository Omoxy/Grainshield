const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILENAME_LENGTH = 255;

interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateMimeType(mimeType: string): ValidationResult {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: `File type '${mimeType}' is not allowed. Accepted: JPEG, PNG, WebP, PDF`,
    };
  }
  return { valid: true };
}

export async function validateFileContent(
  file: File,
): Promise<ValidationResult> {
  const mimeCheck = validateMimeType(file.type);
  if (!mimeCheck.valid) return mimeCheck;

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum: 5MB`,
    };
  }

  if (file.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  if (file.name.length > MAX_FILENAME_LENGTH) {
    return { valid: false, error: "Filename too long" };
  }

  if (/[<>:"/\\|?*\x00-\x1f]/.test(file.name)) {
    return { valid: false, error: "Filename contains invalid characters" };
  }

  if (file.name.includes("..") || file.name.startsWith("/")) {
    return { valid: false, error: "Invalid filename path" };
  }

  const headerBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const expectedMagic = MAGIC_BYTES[file.type];

  if (expectedMagic) {
    const matches = expectedMagic.every(
      (byte, i) => headerBytes[i] === byte,
    );
    if (!matches) {
      return {
        valid: false,
        error: "File content does not match declared type",
      };
    }
  }

  return { valid: true };
}

export async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\./, "_")
    .slice(0, MAX_FILENAME_LENGTH);
}

export function generateSecureFilePath(
  userId: string,
  docType: string,
  extension: string,
): string {
  const timestamp = Date.now();
  const random = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(random, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `kyc/${userId}/${docType}/${timestamp}-${hex}.${extension}`;
}
