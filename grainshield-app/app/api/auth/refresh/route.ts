import { NextResponse, type NextRequest } from "next/server";
import { SESSION_TIMEOUT_SECONDS, type UserRole } from "@/lib/auth/types";
import { verifyToken, signToken } from "@/lib/auth/jwt";
import {
  checkRateLimit,
  extractRateLimitKey,
  REFRESH_RATE_LIMIT,
} from "@/lib/auth/rate-limit";
import { isSessionValid, rotateSession } from "@/lib/security/sessions";
import { createAuditLog, extractIp, generateRequestId } from "@/lib/security/audit";

const TOKEN_COOKIE = "gs_token";

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = extractIp(request);

  const rlKey = extractRateLimitKey(request, "refresh");
  const rl = checkRateLimit(rlKey, REFRESH_RATE_LIMIT);

  if (!rl.allowed) {
    const response = NextResponse.json(
      { authenticated: false, user: null, error: "Too many requests", requestId },
      { status: 429 },
    );
    response.headers.set("Retry-After", String(rl.retryAfterSeconds));
    return response;
  }

  const token = request.cookies.get(TOKEN_COOKIE)?.value;

  if (!token) {
    return NextResponse.json(
      { authenticated: false, user: null },
      { status: 401 },
    );
  }

  let claims;
  try {
    claims = await verifyToken(token);
  } catch {
    return NextResponse.json(
      { authenticated: false, user: null },
      { status: 503 },
    );
  }

  if (!claims) {
    const response = NextResponse.json(
      { authenticated: false, user: null },
      { status: 401 },
    );
    response.cookies.set(TOKEN_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const sessionValid = await isSessionValid(claims.jti).catch(() => true);
  if (!sessionValid) {
    await createAuditLog({
      actorId: claims.sub,
      actorRole: claims.roles[0] ?? "unknown",
      action: "Token refresh rejected: session revoked",
      actionType: "login",
      category: "AUTH",
      severity: "WARNING",
      targetId: claims.sub,
      targetType: "user",
      ipAddress: ip,
      requestId,
    });

    const response = NextResponse.json(
      { authenticated: false, user: null },
      { status: 401 },
    );
    response.cookies.set(TOKEN_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const role = claims.roles[0] as UserRole;
  const ttl = SESSION_TIMEOUT_SECONDS[role] ?? 7200;

  let newToken: string;
  try {
    newToken = await signToken(claims.sub, claims.roles, ttl);
  } catch {
    return NextResponse.json(
      { authenticated: false, user: null },
      { status: 503 },
    );
  }

  const newJti = extractJtiFromToken(newToken);

  try {
    await rotateSession(claims.jti, newJti, ttl);
  } catch (err) {
    console.error("[SESSION] Failed to rotate session:", err);
  }

  const now = Math.floor(Date.now() / 1000);
  const user = {
    sub: claims.sub,
    roles: claims.roles,
    exp: now + ttl,
    iat: now,
  };

  const response = NextResponse.json({ authenticated: true, user });

  response.cookies.set(TOKEN_COOKIE, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ttl,
  });

  return response;
}

function extractJtiFromToken(token: string): string {
  try {
    const parts = token.split(".");
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(payload));
    return decoded.jti ?? "unknown";
  } catch {
    return "unknown";
  }
}
