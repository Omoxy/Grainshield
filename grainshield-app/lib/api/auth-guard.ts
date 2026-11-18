import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, type TokenClaims } from "@/lib/auth/jwt";
import type { UserRole } from "@/lib/auth/types";

const TOKEN_COOKIE = "gs_token";

export interface AuthenticatedContext {
  claims: TokenClaims;
  sub: string;
  roles: UserRole[];
}

type AuthResult =
  | { ok: true; ctx: AuthenticatedContext }
  | { ok: false; response: NextResponse };

export async function requireAuth(
  request: NextRequest,
  allowedRoles?: UserRole[],
): Promise<AuthResult> {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      ),
    };
  }

  if (token.length > 4096) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid token" },
        { status: 401 },
      ),
    };
  }

  const claims = await verifyToken(token);

  if (!claims) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      ),
    };
  }

  const validRoles = claims.roles.filter(
    (r): r is UserRole => r === "farmer" || r === "admin",
  );

  if (validRoles.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No valid roles" },
        { status: 403 },
      ),
    };
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const isAdmin = validRoles.includes("admin");
    const hasRequiredRole = allowedRoles.some((r) => validRoles.includes(r));

    if (!hasRequiredRole && !isAdmin) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 },
        ),
      };
    }
  }

  return {
    ok: true,
    ctx: {
      claims,
      sub: claims.sub,
      roles: validRoles,
    },
  };
}
