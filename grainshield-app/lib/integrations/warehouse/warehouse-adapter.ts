export interface WarehouseReference {
  code: string;
  name: string;
  location: string;
  county: string;
  category: "ncpb" | "private" | "cooperative" | "commercial";
  capacityKg: number;
  intakeAvailable: boolean;
  contactPhone: string | null;
  verifiedAt: Date | null;
  source: string;
}

const VERIFIED_WAREHOUSES: WarehouseReference[] = [
  {
    code: "WH-UG-001",
    name: "Eldoret Central Grain Store",
    location: "Eldoret",
    county: "Uasin Gishu",
    category: "cooperative",
    capacityKg: 500_000,
    intakeAvailable: true,
    contactPhone: null,
    verifiedAt: new Date("2025-01-15"),
    source: "verified_registry",
  },
  {
    code: "WH-UG-002",
    name: "Moiben Grain Depot",
    location: "Moiben",
    county: "Uasin Gishu",
    category: "private",
    capacityKg: 200_000,
    intakeAvailable: true,
    contactPhone: null,
    verifiedAt: new Date("2025-01-15"),
    source: "verified_registry",
  },
  {
    code: "WH-UG-003",
    name: "Turbo Cooperative Store",
    location: "Turbo",
    county: "Uasin Gishu",
    category: "cooperative",
    capacityKg: 150_000,
    intakeAvailable: true,
    contactPhone: null,
    verifiedAt: new Date("2025-01-15"),
    source: "verified_registry",
  },
  {
    code: "WH-TN-001",
    name: "Kitale Grain Depot",
    location: "Kitale",
    county: "Trans Nzoia",
    category: "ncpb",
    capacityKg: 800_000,
    intakeAvailable: true,
    contactPhone: null,
    verifiedAt: new Date("2025-01-15"),
    source: "verified_registry",
  },
  {
    code: "WH-TN-002",
    name: "Endebess Storage Facility",
    location: "Endebess",
    county: "Trans Nzoia",
    category: "private",
    capacityKg: 300_000,
    intakeAvailable: true,
    contactPhone: null,
    verifiedAt: new Date("2025-01-15"),
    source: "verified_registry",
  },
  {
    code: "WH-TN-003",
    name: "Cherangany Cooperative Store",
    location: "Cherangany",
    county: "Trans Nzoia",
    category: "cooperative",
    capacityKg: 180_000,
    intakeAvailable: true,
    contactPhone: null,
    verifiedAt: new Date("2025-01-15"),
    source: "verified_registry",
  },
];

export function getVerifiedWarehouses(county?: string): WarehouseReference[] {
  if (!county) return VERIFIED_WAREHOUSES;
  return VERIFIED_WAREHOUSES.filter(
    (w) => w.county.toLowerCase() === county.toLowerCase()
  );
}

export function getWarehouseByCode(code: string): WarehouseReference | null {
  return VERIFIED_WAREHOUSES.find((w) => w.code === code) ?? null;
}

export async function syncWarehouseRegistry(): Promise<{
  synced: number;
  added: number;
  updated: number;
  errors: string[];
}> {
  try {
    const { db } = await import("@/lib/db");

    let added = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const ref of VERIFIED_WAREHOUSES) {
      try {
        const existing = await db.warehouse.findFirst({
          where: { code: ref.code },
        });

        if (existing) {
          await db.warehouse.update({
            where: { id: existing.id },
            data: {
              name: ref.name,
              location: ref.location,
              county: ref.county,
              capacityKg: ref.capacityKg,
            },
          });
          updated++;
        } else {
          await db.warehouse.create({
            data: {
              code: ref.code,
              name: ref.name,
              location: ref.location,
              county: ref.county,
              capacityKg: ref.capacityKg,
              status: "OPERATIONAL",
            },
          });
          added++;
        }
      } catch (err) {
        errors.push(`${ref.code}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    return { synced: VERIFIED_WAREHOUSES.length, added, updated, errors };
  } catch (err) {
    return {
      synced: 0,
      added: 0,
      updated: 0,
      errors: [err instanceof Error ? err.message : "Database connection failed"],
    };
  }
}
