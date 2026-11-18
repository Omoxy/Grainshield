import { NextResponse } from "next/server";

const MAX_JSON_BODY_SIZE = 1024 * 1024; // 1MB

interface ValidationSchema {
  [field: string]: {
    type: "string" | "number" | "boolean" | "array" | "object";
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: RegExp;
    enum?: readonly string[];
  };
}

interface ValidationErrors {
  [field: string]: string;
}

export function validateBody(
  body: Record<string, unknown>,
  schema: ValidationSchema,
): { valid: true } | { valid: false; errors: ValidationErrors } {
  const errors: ValidationErrors = {};

  for (const [field, rules] of Object.entries(schema)) {
    const value = body[field];

    if (rules.required && (value === undefined || value === null || value === "")) {
      errors[field] = `${field} is required`;
      continue;
    }

    if (value === undefined || value === null) continue;

    if (rules.type === "string") {
      if (typeof value !== "string") {
        errors[field] = `${field} must be a string`;
        continue;
      }
      if (rules.minLength && value.length < rules.minLength) {
        errors[field] = `${field} must be at least ${rules.minLength} characters`;
      }
      if (rules.maxLength && value.length > rules.maxLength) {
        errors[field] = `${field} must be at most ${rules.maxLength} characters`;
      }
      if (rules.pattern && !rules.pattern.test(value)) {
        errors[field] = `${field} format is invalid`;
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors[field] = `${field} must be one of: ${rules.enum.join(", ")}`;
      }
    }

    if (rules.type === "number") {
      const num = typeof value === "number" ? value : Number(value);
      if (isNaN(num)) {
        errors[field] = `${field} must be a number`;
        continue;
      }
      if (rules.min !== undefined && num < rules.min) {
        errors[field] = `${field} must be at least ${rules.min}`;
      }
      if (rules.max !== undefined && num > rules.max) {
        errors[field] = `${field} must be at most ${rules.max}`;
      }
    }

    if (rules.type === "boolean" && typeof value !== "boolean") {
      errors[field] = `${field} must be a boolean`;
    }

    if (rules.type === "array" && !Array.isArray(value)) {
      errors[field] = `${field} must be an array`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}

export async function parseAndValidateJson(
  request: Request,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_JSON_BODY_SIZE) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body too large" },
        { status: 413 },
      ),
    };
  }

  const contentType = request.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 415 },
      ),
    };
  }

  try {
    const text = await request.text();
    if (text.length > MAX_JSON_BODY_SIZE) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Request body too large" },
          { status: 413 },
        ),
      };
    }
    const body = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Request body must be a JSON object" },
          { status: 400 },
        ),
      };
    }
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400 },
      ),
    };
  }
}

export function validateQueryParam(
  value: string | null,
  allowed: readonly string[],
): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase();
  return allowed.includes(cleaned) ? cleaned : null;
}

export function validatePagination(params: {
  page?: string | null;
  limit?: string | null;
  maxLimit?: number;
}): { page: number; limit: number; offset: number } {
  const maxLimit = params.maxLimit ?? 100;
  const page = Math.max(1, parseInt(params.page ?? "1") || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(params.limit ?? "20") || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function normalizeErrorResponse(
  status: number,
  message: string,
  requestId?: string,
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      status,
      ...(requestId ? { requestId } : {}),
    },
    { status },
  );
}
