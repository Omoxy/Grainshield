import { NextResponse, type NextRequest } from "next/server";
import { SESSION_TIMEOUT_SECONDS, type UserRole } from "@/lib/auth/types";
import { signToken } from "@/lib/auth/jwt";
import {
  checkRateLimit,
  resetRateLimit,
  extractRateLimitKey,
  LOGIN_RATE_LIMIT,
} from "@/lib/auth/rate-limit";
import {
  createAuditLog,
  extractIp,
  extractUserAgent,
  generateRequestId,
} from "@/lib/security/audit";
import { createSession } from "@/lib/security/sessions";
import {
  recordLoginAttempt,
  detectSuspiciousLogin,
} from "@/lib/security/login-tracker";

const TOKEN_COOKIE = "gs_token";

const FARMER_SERVICE_URL =
  process.env.FARMER_SERVICE_URL ?? "http://localhost:8080";

const DEV_AUTH_ENABLED =
  process.env.NODE_ENV === "development" &&
  process.env.ALLOW_DEV_AUTH === "true";

const DEV_PASSWORD = process.env.DEV_AUTH_PASSWORD;

const VALID_ROLES: UserRole[] = ["farmer", "admin"];

interface BackendAuthResponse {
  user: {
    id: string;
    roles: string[];
  };
  error?: string;
}

async function authenticateViaBackend(
  identifier: string,
  password: string,
): Promise<{ sub: string; roles: UserRole[] } | null> {
  try {
    const res = await fetch(`${FARMER_SERVICE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const data: BackendAuthResponse = await res.json();
    if (!data.user?.id || !Array.isArray(data.user.roles)) return null;

    const validatedRoles = data.user.roles.filter((r): r is UserRole =>
      VALID_ROLES.includes(r as UserRole),
    );

    if (validatedRoles.length === 0) return null;

    return { sub: data.user.id, roles: validatedRoles };
  } catch {
    return null;
  }
}

function authenticateDevMode(
  identifier: string,
  password: string,
): { sub: string; roles: UserRole[] } | null {
  if (process.env.NODE_ENV === "production") return null;
  if (!DEV_AUTH_ENABLED || !DEV_PASSWORD) return null;
  if (password !== DEV_PASSWORD) return null;

  const lower = identifier.toLowerCase().trim();
  let role: UserRole = "farmer";

  if (lower.startsWith("admin:")) role = "admin";

  const sub = lower.includes(":") ? lower.split(":")[1] : lower;

  console.warn(
    `[DEV AUTH] Authenticated "${sub}" as ${role}. ` +
      "This mode must NEVER be available in production.",
  );

  return { sub: `dev-${sub}`, roles: [role] };
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = extractIp(request);
  const ua = extractUserAgent(request);

  try {
    const rlKey = extractRateLimitKey(request, "login");
    const rl = checkRateLimit(rlKey, LOGIN_RATE_LIMIT);

    if (!rl.allowed) {
      await recordLoginAttempt({
        identifier: "rate_limited",
        ipAddress: ip,
        userAgent: ua,
        result: "RATE_LIMITED",
      });

      const response = NextResponse.json(
        { error: "Too many login attempts. Please try again later.", requestId },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rl.retryAfterSeconds));
      response.headers.set("X-RateLimit-Remaining", "0");
      return response;
    }

    const body = await request.json();
    const { identifier, password } = body as {
      identifier?: string;
      password?: string;
    };

    if (typeof body.role !== "undefined") {
      return NextResponse.json(
        { error: "Client-supplied role is not accepted", requestId },
        { status: 400 },
      );
    }

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Identifier and password are required", requestId },
        { status: 400 },
      );
    }

    if (identifier.length > 200 || password.length > 200) {
      return NextResponse.json(
        { error: "Input too long", requestId },
        { status: 400 },
      );
    }

    let authResult = await authenticateViaBackend(identifier, password);

    if (!authResult) {
      authResult = authenticateDevMode(identifier, password);
    }

    if (!authResult) {
      await recordLoginAttempt({
        identifier,
        ipAddress: ip,
        userAgent: ua,
        result: "INVALID_CREDENTIALS",
        failReason: "Invalid credentials",
      });

      await createAuditLog({
        actorRole: "anonymous",
        action: `Failed login attempt for "${identifier}"`,
        actionType: "login",
        category: "AUTH",
        severity: "WARNING",
        ipAddress: ip,
        userAgent: ua,
        requestId,
      });

      return NextResponse.json(
        { error: "Invalid credentials", requestId },
        { status: 401 },
      );
    }

    resetRateLimit(rlKey);

    const { sub, roles } = authResult;
    const role = roles[0];
    const ttl = SESSION_TIMEOUT_SECONDS[role] ?? 7200;

    let token: string;
    try {
      token = await signToken(sub, roles, ttl);
    } catch (e) {
      console.error("Token signing failed:", (e as Error).message);
      return NextResponse.json(
        { error: "Authentication service unavailable", requestId },
        { status: 503 },
      );
    }

    const jti = extractJtiFromToken(token);

    try {
      await createSession({
        userId: sub,
        jti,
        ipAddress: ip,
        userAgent: ua,
        ttlSeconds: ttl,
      });
    } catch (err) {
      console.error("[SESSION] Failed to create session:", err);
    }

    await recordLoginAttempt({
      identifier,
      ipAddress: ip,
      userAgent: ua,
      result: "SUCCESS",
      userId: sub,
    });

    const suspicion = await detectSuspiciousLogin({
      userId: sub,
      ipAddress: ip,
    }).catch(() => ({ suspicious: false }));

    const severity = suspicion.suspicious ? "WARNING" : "INFO";

    await createAuditLog({
      actorId: sub,
      actorRole: role,
      action: `User logged in${suspicion.suspicious ? " (suspicious)" : ""}`,
      actionType: "login",
      category: "AUTH",
      severity,
      targetId: sub,
      targetType: "user",
      details: suspicion.suspicious
        ? `Suspicious: ${(suspicion as { reason?: string }).reason}`
        : undefined,
      ipAddress: ip,
      userAgent: ua,
      requestId,
    });

    const now = Math.floor(Date.now() / 1000);
    const user = { sub, roles, exp: now + ttl, iat: now };

    const response = NextResponse.json({
      user,
      sessionTimeoutSeconds: ttl,
      requestId,
    });

    response.cookies.set(TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: ttl,
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Internal server error", requestId },
      { status: 500 },
    );
  }
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
