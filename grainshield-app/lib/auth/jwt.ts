/**
 * Server-side JWT operations for Next.js API routes.
 *
 * Uses Web Crypto API (available in Edge and Node runtimes) for
 * HMAC-SHA256 signing and verification. Single source of truth
 * for all token operations in the frontend layer.
 *
 * SECURITY: The JWT_SECRET env var is REQUIRED. If missing, all
 * token operations fail closed — no fallback, no dev shortcut.
 */

import type { UserRole } from "./types";

export interface TokenClaims {
  sub: string;
  roles: UserRole[];
  iat: number;
  exp: number;
  iss: string;
  jti: string;
}

const ISSUER = "grainshield";
const ALGORITHM = "HS256";

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "FATAL: JWT_SECRET environment variable is not set. " +
        "The application cannot issue or verify tokens without it. " +
        "Set JWT_SECRET to a cryptographically random value (min 32 bytes).",
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "FATAL: JWT_SECRET is too short. Must be at least 32 characters.",
    );
  }
  return secret;
}

function base64url(input: string): string {
  return btoa(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): string {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return atob(padded);
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmacVerify(
  data: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const sigBytes = Uint8Array.from(
    atob(signature.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(data),
  );
}

function generateJti(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create a signed JWT. Fails if JWT_SECRET is not set.
 */
export async function signToken(
  sub: string,
  roles: UserRole[],
  ttlSeconds: number,
): Promise<string> {
  const secret = getSecret();

  const header = base64url(JSON.stringify({ alg: ALGORITHM, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      sub,
      roles,
      iat: now,
      exp: now + ttlSeconds,
      iss: ISSUER,
      jti: generateJti(),
    } satisfies TokenClaims),
  );

  const data = `${header}.${payload}`;
  const sig = await hmacSign(data, secret);
  return `${data}.${sig}`;
}

/**
 * Verify a JWT signature and decode claims. Returns null if:
 * - JWT_SECRET is not set (fail closed)
 * - token is malformed
 * - signature is invalid
 * - token is expired
 * - issuer doesn't match
 * - required fields are missing
 */
export async function verifyToken(token: string): Promise<TokenClaims | null> {
  try {
    const secret = getSecret();

    if (token.length > 4096) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) return null;

    let headerObj: { alg?: string; typ?: string };
    try {
      headerObj = JSON.parse(base64urlDecode(header));
    } catch {
      return null;
    }

    // Strictly enforce HS256 algorithm: reject 'none' and all other algorithms
    if (headerObj.alg !== ALGORITHM || headerObj.typ !== "JWT") {
      return null;
    }

    const data = `${header}.${payload}`;

    const valid = await hmacVerify(data, signature, secret);
    if (!valid) return null;

    const decoded = JSON.parse(base64urlDecode(payload));

    if (
      typeof decoded.sub !== "string" ||
      !Array.isArray(decoded.roles) ||
      typeof decoded.exp !== "number" ||
      typeof decoded.iat !== "number"
    ) {
      return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (decoded.exp <= nowSeconds) return null;

    if (decoded.iss && decoded.iss !== ISSUER) return null;

    return decoded as TokenClaims;
  } catch {
    return null;
  }
}
