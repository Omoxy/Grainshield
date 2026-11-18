/**
 * GET /api/auth/me
 *
 * Verifies the JWT from the httpOnly cookie and returns the
 * authenticated user object.
 *
 * SECURITY: Token signature is cryptographically verified.
 * Forged or expired tokens return { authenticated: false }.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth/jwt";

const TOKEN_COOKIE = "gs_token";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ authenticated: false, user: null });
  }

  let claims;
  try {
    claims = await verifyToken(token);
  } catch {
    return NextResponse.json({ authenticated: false, user: null });
  }

  if (!claims) {
    const response = NextResponse.json({ authenticated: false, user: null });
    response.cookies.set(TOKEN_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const isDev = claims.sub.startsWith("dev-");

  return NextResponse.json({
    authenticated: true,
    user: {
      sub: claims.sub,
      roles: claims.roles,
      exp: claims.exp,
      iat: claims.iat,
      ...(isDev && {
        accountStatus: "APPROVED",
        fullName: claims.roles.includes("admin") ? "Dev Admin" : "Dev Farmer",
      }),
    },
  });
}
