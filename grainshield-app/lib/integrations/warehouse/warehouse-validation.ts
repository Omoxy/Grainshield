export interface ReceiptValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface GrainLotInput {
  grainType: string;
  quantityKg: number;
  grade: string;
  moisturePct: number | null;
  warehouseCode: string;
  depositorId: string;
}

const VALID_GRADES = ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Reject"];
const VALID_GRAIN_TYPES = ["Maize", "Wheat", "Sorghum", "Millet", "Rice"];
const MAX_MOISTURE_PCT = 14.0;
const WARNING_MOISTURE_PCT = 13.0;
const MIN_QUANTITY_KG = 10;
const MAX_QUANTITY_KG = 100_000;

export function validateGrainLot(input: GrainLotInput): ReceiptValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.grainType || !VALID_GRAIN_TYPES.includes(input.grainType)) {
    errors.push(`Invalid grain type. Must be one of: ${VALID_GRAIN_TYPES.join(", ")}`);
  }

  if (!input.quantityKg || input.quantityKg < MIN_QUANTITY_KG) {
    errors.push(`Quantity must be at least ${MIN_QUANTITY_KG} kg`);
  } else if (input.quantityKg > MAX_QUANTITY_KG) {
    errors.push(`Quantity exceeds maximum of ${MAX_QUANTITY_KG.toLocaleString()} kg per deposit`);
  }

  if (!input.grade || !VALID_GRADES.includes(input.grade)) {
    errors.push(`Invalid grade. Must be one of: ${VALID_GRADES.join(", ")}`);
  }

  if (input.grade === "Reject") {
    warnings.push("Reject-grade grain may not be eligible for warehouse receipt financing");
  }

  if (input.moisturePct !== null) {
    if (input.moisturePct > MAX_MOISTURE_PCT) {
      errors.push(`Moisture content ${input.moisturePct}% exceeds maximum of ${MAX_MOISTURE_PCT}%. Grain must be dried before acceptance.`);
    } else if (input.moisturePct > WARNING_MOISTURE_PCT) {
      warnings.push(`Moisture content ${input.moisturePct}% is above recommended ${WARNING_MOISTURE_PCT}%. Additional drying is advised.`);
    }
  } else {
    warnings.push("No moisture reading provided. Moisture test is recommended before deposit.");
  }

  if (!input.warehouseCode) {
    errors.push("Warehouse code is required");
  }

  if (!input.depositorId) {
    errors.push("Depositor ID is required");
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateCsvRow(
  row: Record<string, string>,
  rowIndex: number
): { input: GrainLotInput | null; errors: string[] } {
  const errors: string[] = [];

  const grainType = (row.grain_type || row.grainType || row.type || "").trim();
  const quantityStr = (row.quantity_kg || row.quantityKg || row.quantity || "").trim();
  const grade = (row.grade || "").trim();
  const moistureStr = (row.moisture_pct || row.moisturePct || row.moisture || "").trim();
  const warehouseCode = (row.warehouse_code || row.warehouseCode || row.warehouse || "").trim();
  const depositorId = (row.depositor_id || row.depositorId || row.farmer_id || row.farmerId || "").trim();

  if (!grainType) errors.push(`Row ${rowIndex}: Missing grain type`);
  if (!quantityStr) errors.push(`Row ${rowIndex}: Missing quantity`);
  if (!warehouseCode) errors.push(`Row ${rowIndex}: Missing warehouse code`);
  if (!depositorId) errors.push(`Row ${rowIndex}: Missing depositor ID`);

  const quantity = parseFloat(quantityStr);
  if (quantityStr && isNaN(quantity)) {
    errors.push(`Row ${rowIndex}: Invalid quantity "${quantityStr}"`);
  }

  const moisture = moistureStr ? parseFloat(moistureStr) : null;
  if (moistureStr && isNaN(moisture!)) {
    errors.push(`Row ${rowIndex}: Invalid moisture "${moistureStr}"`);
  }

  if (errors.length > 0) return { input: null, errors };

  return {
    input: {
      grainType,
      quantityKg: quantity,
      grade: grade || "Grade 2",
      moisturePct: moisture,
      warehouseCode,
      depositorId,
    },
    errors: [],
  };
}
