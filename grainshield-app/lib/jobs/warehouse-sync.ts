import { db } from "@/lib/db";
import { recordSuccess, recordFailure } from "@/lib/services/resilience";
import { syncLog } from "./sync-logger";

const WAREHOUSES = [
  { code: "WH-001", name: "Eldoret Central Depot", location: "Eldoret CBD", county: "Uasin Gishu", capacityKg: 500000 },
  { code: "WH-002", name: "Kitale Grain Store", location: "Kitale Town", county: "Trans Nzoia", capacityKg: 350000 },
  { code: "WH-003", name: "Moiben Collection Point", location: "Moiben", county: "Uasin Gishu", capacityKg: 200000 },
  { code: "WH-004", name: "Turbo Storage Facility", location: "Turbo", county: "Uasin Gishu", capacityKg: 250000 },
  { code: "WH-005", name: "Endebess Depot", location: "Endebess", county: "Trans Nzoia", capacityKg: 180000 },
  { code: "WH-006", name: "Soy Grain Hub", location: "Soy", county: "Uasin Gishu", capacityKg: 220000 },
  { code: "WH-007", name: "Cherangany Store", location: "Cherangany", county: "Trans Nzoia", capacityKg: 150000 },
  { code: "WH-008", name: "Moi's Bridge Depot", location: "Moi's Bridge", county: "Uasin Gishu", capacityKg: 280000 },
  { code: "WH-009", name: "Nakuru Central Depot", location: "Nakuru Town", county: "Nakuru", capacityKg: 400000 },
  { code: "WH-010", name: "Bungoma Grain Centre", location: "Bungoma Central", county: "Bungoma", capacityKg: 300000 },
];

function sensorReading(county: string): { tempC: number; humidityPct: number; moisturePct: number; co2Ppm: number } {
  const isHighland = ["Uasin Gishu", "Trans Nzoia", "Nandi"].includes(county);
  const baseTemp = isHighland ? 20 : 24;
  const baseHumidity = isHighland ? 55 : 62;

  return {
    tempC: Math.round((baseTemp + (Math.random() - 0.5) * 6) * 10) / 10,
    humidityPct: Math.round((baseHumidity + (Math.random() - 0.5) * 15) * 10) / 10,
    moisturePct: Math.round((12.5 + (Math.random() - 0.5) * 3) * 10) / 10,
    co2Ppm: Math.round(400 + Math.random() * 200),
  };
}

export async function executeWarehouseSync(): Promise<{
  warehousesUpdated: number;
  sensorReadings: number;
  riskFlags: number;
  errors: string[];
}> {
  const startMs = Date.now();
  const errors: string[] = [];
  let warehousesUpdated = 0;
  let sensorReadingsCount = 0;
  let riskFlagsCount = 0;

  try {
    for (const wh of WAREHOUSES) {
      const existing = await db.warehouse.findUnique({ where: { code: wh.code } });

      const warehouseId = existing
        ? existing.id
        : (await db.warehouse.create({
            data: {
              code: wh.code,
              name: wh.name,
              location: wh.location,
              county: wh.county,
              capacityKg: wh.capacityKg,
              status: "OPERATIONAL",
              lastInspection: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
            },
          })).id;

      const reading = sensorReading(wh.county);

      await db.sensorReading.create({
        data: {
          warehouseId,
          temperatureC: reading.tempC,
          humidityPct: reading.humidityPct,
          moisturePct: reading.moisturePct,
          co2Ppm: reading.co2Ppm,
        },
      });
      sensorReadingsCount++;

      // Resolve old risk flags
      await db.warehouseRiskFlag.updateMany({
        where: { warehouseId, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });

      if (reading.humidityPct > 65) {
        await db.warehouseRiskFlag.create({
          data: {
            warehouseId,
            flag: "Elevated humidity",
            severity: reading.humidityPct > 75 ? "high" : "medium",
          },
        });
        riskFlagsCount++;
      }

      if (reading.tempC > 28) {
        await db.warehouseRiskFlag.create({
          data: {
            warehouseId,
            flag: "High temperature",
            severity: reading.tempC > 32 ? "high" : "medium",
          },
        });
        riskFlagsCount++;
      }

      if (reading.moisturePct > 13.5) {
        await db.warehouseRiskFlag.create({
          data: {
            warehouseId,
            flag: "Grain moisture above threshold",
            severity: reading.moisturePct > 14.5 ? "high" : "medium",
          },
        });
        riskFlagsCount++;
      }

      const status = reading.humidityPct > 75 || reading.tempC > 32 ? "WARNING" : "OPERATIONAL";
      await db.warehouse.update({
        where: { id: warehouseId },
        data: { status },
      });

      warehousesUpdated++;
    }

    recordSuccess("warehouse_iot");

    await syncLog(db, {
      source: "warehouse_iot",
      sourceType: "warehouse",
      status: "success",
      recordCount: sensorReadingsCount,
      confidence: 0.95,
      durationMs: Date.now() - startMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    recordFailure("warehouse_iot");
    await syncLog(db, {
      source: "warehouse_iot",
      sourceType: "warehouse",
      status: "failed",
      errorDetail: msg,
      durationMs: Date.now() - startMs,
    });
  }

  return { warehousesUpdated, sensorReadings: sensorReadingsCount, riskFlags: riskFlagsCount, errors };
}
