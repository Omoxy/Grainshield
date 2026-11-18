import { canExecute, recordSuccess, recordFailure } from "@/lib/services/resilience";

export interface WarehouseSummary {
  id: string;
  code: string;
  name: string;
  location: string;
  county: string;
  capacityKg: number;
  usedKg: number;
  utilizationPct: number;
  temperatureC: number | null;
  humidityPct: number | null;
  status: "operational" | "warning" | "offline" | "maintenance";
  lastInspection: Date | null;
  riskFlags: string[];
  farmersCount: number;
  lastSensorReading: Date | null;
}

export interface WarehousePortfolioSummary {
  totalWarehouses: number;
  operationalCount: number;
  totalCapacityKg: number;
  totalUsedKg: number;
  utilizationPct: number;
  riskFlagCount: number;
}

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function getWarehouseSummaries(filters?: {
  status?: string;
  county?: string;
}): Promise<WarehouseSummary[]> {
  const serviceId = "warehouse_iot";

  try {
    const db = await getDb();
    if (!db) return [];

    const where: Record<string, unknown> = {};
    if (filters?.status) {
      where.status = filters.status.toUpperCase();
    }
    if (filters?.county) {
      where.county = { contains: filters.county, mode: "insensitive" };
    }

    const warehouses = await db.warehouse.findMany({
      where: where as never,
      include: {
        sensorReadings: {
          orderBy: { recordedAt: "desc" },
          take: 1,
        },
        riskFlags: {
          where: { resolvedAt: null },
        },
        receipts: {
          where: { deletedAt: null },
          select: { quantityKg: true, userId: true },
        },
      },
    });

    if (canExecute(serviceId)) {
      recordSuccess(serviceId);
    }

    return warehouses.map((w) => {
      const reading = w.sensorReadings[0];
      const usedKg = w.receipts.reduce((sum, r) => sum + r.quantityKg, 0);
      const uniqueFarmers = new Set(w.receipts.map((r) => r.userId)).size;

      return {
        id: w.id,
        code: w.code,
        name: w.name,
        location: w.location,
        county: w.county,
        capacityKg: w.capacityKg,
        usedKg: Math.round(usedKg),
        utilizationPct: w.capacityKg > 0 ? Math.round((usedKg / w.capacityKg) * 100) : 0,
        temperatureC: reading?.temperatureC ?? null,
        humidityPct: reading?.humidityPct ?? null,
        status: w.status.toLowerCase() as WarehouseSummary["status"],
        lastInspection: w.lastInspection,
        riskFlags: w.riskFlags.map((f) => f.flag),
        farmersCount: uniqueFarmers,
        lastSensorReading: reading?.recordedAt ?? null,
      };
    });
  } catch {
    if (canExecute(serviceId)) recordFailure(serviceId);
    return [];
  }
}

export async function getPortfolioSummary(): Promise<WarehousePortfolioSummary> {
  const warehouses = await getWarehouseSummaries();

  const totalCapacityKg = warehouses.reduce((s, w) => s + w.capacityKg, 0);
  const totalUsedKg = warehouses.reduce((s, w) => s + w.usedKg, 0);

  return {
    totalWarehouses: warehouses.length,
    operationalCount: warehouses.filter((w) => w.status === "operational").length,
    totalCapacityKg,
    totalUsedKg,
    utilizationPct: totalCapacityKg > 0 ? Math.round((totalUsedKg / totalCapacityKg) * 100) : 0,
    riskFlagCount: warehouses.filter((w) => w.riskFlags.length > 0).length,
  };
}

export async function getWarehouseById(idOrCode: string): Promise<WarehouseSummary | null> {
  const all = await getWarehouseSummaries();
  return all.find((w) => w.id === idOrCode || w.code === idOrCode) ?? null;
}

export async function getFarmerStorageSummary(userId: string): Promise<{
  totalStoredKg: number;
  receipts: {
    receiptCode: string;
    warehouseName: string;
    warehouseLocation: string;
    quantityKg: number;
    grade: string;
    healthStatus: string;
    depositDate: Date;
    temperatureC: number | null;
    humidityPct: number | null;
    moisturePct: number | null;
  }[];
}> {
  try {
    const db = await getDb();
    if (!db) return { totalStoredKg: 0, receipts: [] };

    const receipts = await db.warehouseReceipt.findMany({
      where: { userId, deletedAt: null },
      include: {
        warehouse: {
          include: {
            sensorReadings: {
              orderBy: { recordedAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { depositDate: "desc" },
    });

    return {
      totalStoredKg: receipts.reduce((s, r) => s + r.quantityKg, 0),
      receipts: receipts.map((r) => {
        const sensor = r.warehouse.sensorReadings[0];
        return {
          receiptCode: r.receiptCode,
          warehouseName: r.warehouse.name,
          warehouseLocation: `${r.warehouse.location}, ${r.warehouse.county}`,
          quantityKg: r.quantityKg,
          grade: r.grade,
          healthStatus: r.healthStatus.toLowerCase(),
          depositDate: r.depositDate,
          temperatureC: r.temperatureC ?? sensor?.temperatureC ?? null,
          humidityPct: r.humidityPct ?? sensor?.humidityPct ?? null,
          moisturePct: r.moisturePct ?? sensor?.moisturePct ?? null,
        };
      }),
    };
  } catch {
    return { totalStoredKg: 0, receipts: [] };
  }
}
