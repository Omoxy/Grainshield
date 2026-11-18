import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth/jwt";
import { revokeSession } from "@/lib/security/sessions";
import { createAuditLog, extractIp, generateRequestId } from "@/lib/security/audit";

const TOKEN_COOKIE = "gs_token";

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = extractIp(request);

  const token = request.cookies.get(TOKEN_COOKIE)?.value;

  if (token) {
    try {
      const claims = await verifyToken(token);
      if (claims) {
        await revokeSession(claims.jti, "user_logout");

        await createAuditLog({
          actorId: claims.sub,
          actorRole: claims.roles[0] ?? "unknown",
          action: "User logged out",
          actionType: "logout",
          category: "AUTH",
          targetId: claims.sub,
          targetType: "user",
          ipAddress: ip,
          requestId,
        });
      }
    } catch {
      // Logout should always succeed even if token is invalid
    }
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set(TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });

  return response;
}
