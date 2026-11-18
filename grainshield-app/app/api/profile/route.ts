import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";

async function getDb() {
  const { db } = await import("@/lib/db");
  return db;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["farmer", "admin"]);
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const user = await db.user.findUnique({
      where: { id: auth.ctx.sub },
      include: {
        farmerProfile: true,
        kycDocuments: {
          select: {
            id: true,
            type: true,
            status: true,
            uploadedAt: true,
            reviewedAt: true,
          },
          orderBy: { uploadedAt: "desc" },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const profile = (user as unknown as { farmerProfile?: { county?: string; ward?: string; village?: string } }).farmerProfile;
    const kycDocs = (user as unknown as { kycDocuments: { id: string; type: string; status: string; uploadedAt: Date }[] }).kycDocuments;

    return NextResponse.json({
      profile: {
        fullName: user.fullName,
        phone: user.phone,
        email: user.email ?? "",
        county: profile?.county ?? "",
        ward: profile?.ward ?? "",
        village: profile?.village ?? "",
        accountStatus: user.accountStatus,
        registeredDate: user.createdAt.toISOString().split("T")[0],
        kycDocuments: kycDocs.map((d: { id: string; type: string; status: string; uploadedAt: Date }) => ({
          id: d.id,
          type: d.type.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
          status: d.status.toLowerCase(),
          uploadedDate: d.uploadedAt.toISOString().split("T")[0],
        })),
      },
    });
  } catch (err) {
    console.error("[API] Profile error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
