import { NextResponse, type NextRequest } from "next/server";
import { checkApiRateLimit as apiRateLimit } from "@/lib/security/api-rate-limit";
import { verifyToken } from "@/lib/auth/jwt";

const TOKEN_COOKIE = "gs_token";

const ROUTE_ROLE_MAP: { prefix: string; role: string }[] = [
  { prefix: "/admin", role: "admin" },
  { prefix: "/farmer", role: "farmer" },
];

const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/ussd",
  "/api/auth",
  "/api/kyc",
  "/_next",
  "/favicon.ico",
];

const ROLE_HOME: Record<string, string> = {
  farmer: "/farmer/home",
  admin: "/admin/overview",
};

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const traceId = request.headers.get("x-trace-id") ?? generateTraceId();

  if (pathname === "/") {
    const response = NextResponse.next();
    response.headers.set("x-trace-id", traceId);
    return response;
  }

  if (pathname.startsWith("/api/")) {
    const rateLimitResponse = apiRateLimit(request);
    if (rateLimitResponse) {
      rateLimitResponse.headers.set("x-trace-id", traceId);
      return rateLimitResponse;
    }

    return addApiSecurityHeaders(NextResponse.next(), request, traceId);
  }

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (pathname.startsWith("/login")) {
      const token = request.cookies.get(TOKEN_COOKIE)?.value;
      if (token) {
        const claims = await verifyToken(token);
        if (claims) {
          const home = ROLE_HOME[claims.roles[0]] ?? "/farmer";
          return NextResponse.redirect(new URL(home, request.url));
        }
      }
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(TOKEN_COOKIE)?.value;

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const claims = await verifyToken(token);

  if (!claims) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(TOKEN_COOKIE);
    return response;
  }

  const requiredRule = ROUTE_ROLE_MAP.find((r) =>
    pathname.startsWith(r.prefix),
  );

  if (requiredRule) {
    const hasRole = claims.roles.includes(requiredRule.role as any);
    const isAdmin = claims.roles.includes("admin" as any);

    if (!hasRole && !isAdmin) {
      const home = ROLE_HOME[claims.roles[0]] ?? "/farmer";
      return NextResponse.redirect(new URL(home, request.url));
    }
  }

  return addSecurityHeaders(NextResponse.next(), traceId);
}

function addSecurityHeaders(response: NextResponse, traceId?: string): NextResponse {
  if (traceId) response.headers.set("x-trace-id", traceId);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=()",
  );
  const isProd = process.env.NODE_ENV === "production";
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      isProd
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  );
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  return response;
}

function addApiSecurityHeaders(
  response: NextResponse,
  request: NextRequest,
  traceId?: string,
): NextResponse {
  if (traceId) response.headers.set("x-trace-id", traceId);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  response.headers.set("Pragma", "no-cache");

  if (request.method === "OPTIONS") {
    response.headers.set("Access-Control-Max-Age", "86400");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
