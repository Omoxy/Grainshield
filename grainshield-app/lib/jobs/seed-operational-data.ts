import { db } from "@/lib/db";
import * as crypto from "crypto";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export async function seedOperationalData(): Promise<{
  users: number;
  farmers: number;
  warehouses: number;
  receipts: number;
  grainLots: number;
  permissions: number;
}> {
  const counts = { users: 0, farmers: 0, warehouses: 0, receipts: 0, grainLots: 0, permissions: 0 };

  // Admin user
  const adminExists = await db.user.findFirst({ where: { role: "ADMIN" } });
  if (!adminExists) {
    await db.user.create({
      data: {
        fullName: "GrainShield Admin",
        email: "admin@grainshield.co.ke",
        phone: "+254700000001",
        passwordHash: hashPassword("grainshield-admin-2024"),
        role: "ADMIN",
        accountStatus: "APPROVED",
        emailVerifiedAt: new Date(),
      },
    });
    counts.users++;
  }

  // Super Admin
  const superAdminExists = await db.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!superAdminExists) {
    await db.user.create({
      data: {
        fullName: "System Administrator",
        email: "sysadmin@grainshield.co.ke",
        phone: "+254700000000",
        passwordHash: hashPassword("grainshield-sysadmin-2024"),
        role: "SUPER_ADMIN",
        accountStatus: "APPROVED",
        emailVerifiedAt: new Date(),
      },
    });
    counts.users++;
  }

  // Seed farmers with profiles
  const farmerSeeds = [
    { name: "Joseph Kipchoge", email: "jkipchoge@example.com", phone: "+254711000001", county: "Uasin Gishu", ward: "Moiben", crop: "Maize", farmHa: 12 },
    { name: "Mary Jepkosgei", email: "mjepkosgei@example.com", phone: "+254711000002", county: "Trans Nzoia", ward: "Endebess", crop: "Maize", farmHa: 8 },
    { name: "Peter Korir", email: "pkorir@example.com", phone: "+254711000003", county: "Uasin Gishu", ward: "Turbo", crop: "Maize", farmHa: 15 },
    { name: "Grace Chebet", email: "gchebet@example.com", phone: "+254711000004", county: "Uasin Gishu", ward: "Soy", crop: "Maize", farmHa: 6 },
    { name: "David Kiptoo", email: "dkiptoo@example.com", phone: "+254711000005", county: "Trans Nzoia", ward: "Kitale", crop: "Maize", farmHa: 20 },
    { name: "Alice Jebiwott", email: "ajebiwott@example.com", phone: "+254711000006", county: "Trans Nzoia", ward: "Cherangany", crop: "Maize", farmHa: 10 },
    { name: "Samuel Kibet", email: "skibet@example.com", phone: "+254711000007", county: "Nandi", ward: "Kabiyet", crop: "Maize", farmHa: 9 },
    { name: "Ruth Jerono", email: "rjerono@example.com", phone: "+254711000008", county: "Uasin Gishu", ward: "Eldoret", crop: "Maize", farmHa: 5 },
    { name: "James Rotich", email: "jrotich@example.com", phone: "+254711000009", county: "Uasin Gishu", ward: "Moi's Bridge", crop: "Maize", farmHa: 18 },
    { name: "Faith Chepkemoi", email: "fchepkemoi@example.com", phone: "+254711000010", county: "Bungoma", ward: "Bungoma Central", crop: "Maize", farmHa: 7 },
    { name: "Daniel Sang", email: "dsang@example.com", phone: "+254711000011", county: "Trans Nzoia", ward: "Ziwa", crop: "Maize", farmHa: 14 },
    { name: "Esther Kiplagat", email: "ekiplagat@example.com", phone: "+254711000012", county: "Nakuru", ward: "Nakuru Town", crop: "Maize", farmHa: 11 },
  ];

  const farmerIds: string[] = [];
  for (const f of farmerSeeds) {
    const exists = await db.user.findUnique({ where: { email: f.email } });
    if (exists) {
      farmerIds.push(exists.id);
      continue;
    }

    const user = await db.user.create({
      data: {
        fullName: f.name,
        email: f.email,
        phone: f.phone,
        passwordHash: hashPassword("farmer-dev-2024"),
        role: "FARMER",
        accountStatus: "APPROVED",
        emailVerifiedAt: new Date(),
      },
    });

    await db.farmerProfile.create({
      data: {
        userId: user.id,
        county: f.county,
        ward: f.ward,
        primaryCrop: f.crop,
        farmSizeHa: f.farmHa,
        farmingExperience: `${Math.floor(Math.random() * 15) + 3} years`,
      },
    });

    farmerIds.push(user.id);
    counts.users++;
    counts.farmers++;
  }

  // Ensure warehouses exist
  const warehouses = await db.warehouse.findMany();
  if (warehouses.length === 0) {
    return counts; // warehouse-sync will create these
  }

  // Seed warehouse receipts and grain lots
  const existingReceipts = await db.warehouseReceipt.count();
  if (existingReceipts === 0 && farmerIds.length > 0 && warehouses.length > 0) {
    let receiptSeq = 1;
    let lotSeq = 1;
    const grades: ("A" | "B" | "C")[] = ["A", "B", "B", "B", "C"];

    for (let i = 0; i < Math.min(farmerIds.length, 12); i++) {
      const wh = warehouses[i % warehouses.length];
      const qty = Math.round((500 + Math.random() * 4500) / 10) * 10;
      const grade = grades[Math.floor(Math.random() * grades.length)];
      const depositDate = new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000);
      const pricePerKg = grade === "A" ? 42 : grade === "B" ? 38 : 33;

      const receipt = await db.warehouseReceipt.create({
        data: {
          receiptCode: `WR-2025-${String(receiptSeq++).padStart(4, "0")}`,
          userId: farmerIds[i],
          warehouseId: wh.id,
          grainType: "Maize",
          quantityKg: qty,
          grade,
          healthStatus: "SAFE",
          depositDate,
          estimatedValueKsh: qty * pricePerKg,
          temperatureC: 20 + Math.random() * 4,
          humidityPct: 50 + Math.random() * 15,
          moisturePct: 11.5 + Math.random() * 2,
        },
      });
      counts.receipts++;

      await db.grainLot.create({
        data: {
          lotCode: `GL-2025-${String(lotSeq++).padStart(4, "0")}`,
          warehouseId: wh.id,
          warehouseReceiptId: receipt.id,
          farmerId: farmerIds[i],
          grainType: "Maize",
          quantityKg: qty,
          currentQuantityKg: qty,
          grade,
          status: "STORED",
          qualityScore: grade === "A" ? 90 + Math.random() * 10 : grade === "B" ? 70 + Math.random() * 20 : 50 + Math.random() * 20,
          moistureAtIntake: 11.5 + Math.random() * 2,
          temperatureAtIntake: 20 + Math.random() * 4,
          originCounty: wh.county,
          intakeDate: depositDate,
        },
      });
      counts.grainLots++;
    }
  }

  // Seed permissions
  const permCount = await db.permission.count();
  if (permCount === 0) {
    const resources = ["claims", "kyc", "warehouses", "loans", "farmers", "audit", "risk", "prices", "payouts"];
    const actions = ["read", "create", "update", "delete", "approve", "reject", "export"];
    const adminPerms = resources.flatMap((resource) =>
      actions.map((action) => ({ role: "ADMIN" as const, resource, action, granted: true })),
    );
    const superAdminPerms = resources.flatMap((resource) =>
      actions.map((action) => ({ role: "SUPER_ADMIN" as const, resource, action, granted: true })),
    );
    const farmerPerms = [
      { role: "FARMER" as const, resource: "claims", action: "read", granted: true },
      { role: "FARMER" as const, resource: "claims", action: "create", granted: true },
      { role: "FARMER" as const, resource: "warehouses", action: "read", granted: true },
      { role: "FARMER" as const, resource: "loans", action: "read", granted: true },
      { role: "FARMER" as const, resource: "loans", action: "create", granted: true },
      { role: "FARMER" as const, resource: "prices", action: "read", granted: true },
      { role: "FARMER" as const, resource: "risk", action: "read", granted: true },
    ];

    await db.permission.createMany({ data: [...adminPerms, ...superAdminPerms, ...farmerPerms] });
    counts.permissions = adminPerms.length + superAdminPerms.length + farmerPerms.length;
  }

  return counts;
}
