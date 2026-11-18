"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Check,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
} from "lucide-react";

const STEPS = ["Claim Type", "Details & Evidence", "Review & Submit"];

const CLAIM_CATEGORIES = [
  { key: "pre_harvest", label: "Pre-Harvest" },
  { key: "post_harvest", label: "Post-Harvest" },
] as const;

const CLAIM_TYPES = [
  { value: "drought", label: "Drought", description: "Crop loss due to prolonged dry conditions or rainfall deficit", category: "pre_harvest" },
  { value: "excess_rainfall", label: "Excess Rainfall", description: "Crop damage from flooding or waterlogging during growing season", category: "pre_harvest" },
  { value: "flood_exposure", label: "Flood Exposure", description: "Field or harvest loss from regional flood events", category: "pre_harvest" },
  { value: "crop_stress", label: "Crop Stress / NDVI Anomaly", description: "Vegetation health decline detected via satellite indicators", category: "pre_harvest" },
  { value: "pest_outbreak_field", label: "Field Pest Outbreak", description: "Pre-harvest pest infestation (e.g. fall armyworm, locusts)", category: "pre_harvest" },
  { value: "harvest_failure", label: "Harvest Failure", description: "Total or partial harvest loss from weather or agronomic conditions", category: "pre_harvest" },
  { value: "storage_spoilage", label: "Storage Spoilage", description: "Grain spoiled due to improper storage conditions", category: "post_harvest" },
  { value: "moisture_damage", label: "Moisture Damage", description: "Damage caused by excess moisture or humidity in storage", category: "post_harvest" },
  { value: "contamination", label: "Contamination", description: "Aflatoxin or other contamination events", category: "post_harvest" },
  { value: "pest_damage", label: "Pest Damage", description: "Weevil, rodent, or other pest infestation in storage", category: "post_harvest" },
  { value: "warehouse_handling", label: "Warehouse Handling Failure", description: "Loss due to warehouse mishandling", category: "post_harvest" },
  { value: "quality_degradation", label: "Grain Quality Degradation", description: "Grade decline during storage beyond acceptable thresholds", category: "post_harvest" },
];

export default function NewClaimPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [claimCategory, setClaimCategory] = useState<"pre_harvest" | "post_harvest">("post_harvest");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState({
    claimType: "",
    warehouseReceipt: "",
    dateOfEvent: "",
    quantityAffectedKg: "",
    description: "",
    estimatedLossKsh: "",
    fieldLocation: "",
    acreageAffected: "",
  });

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const body: Record<string, unknown> = {
        category: form.claimType,
        description: form.description.trim(),
        estimatedLossKsh: form.estimatedLossKsh ? Number(form.estimatedLossKsh) : undefined,
      };

      if (claimCategory === "post_harvest") {
        body.warehouseReceiptId = form.warehouseReceipt;
        if (form.quantityAffectedKg) body.quantityAffectedKg = Number(form.quantityAffectedKg);
      } else {
        body.warehouseReceiptId = "FIELD-CLAIM";
        if (form.fieldLocation) body.fieldLocation = form.fieldLocation;
        if (form.acreageAffected) body.acreageAffected = Number(form.acreageAffected);
      }

      if (form.dateOfEvent) body.dateOfEvent = form.dateOfEvent;

      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error ?? "Submission failed");
        return;
      }

      router.push("/farmer/claims");
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const isPreHarvest = claimCategory === "pre_harvest";

  const canNext =
    step === 0
      ? isPreHarvest
        ? form.claimType !== ""
        : form.claimType !== "" && form.warehouseReceipt !== ""
      : step === 1
        ? form.dateOfEvent && form.description && (isPreHarvest ? form.acreageAffected : form.quantityAffectedKg)
        : true;

  const selectedType = CLAIM_TYPES.find((t) => t.value === form.claimType);

  return (
    <div className="max-w-2xl">
      <button
        onClick={() => router.push("/farmer/claims")}
        className="flex items-center gap-1.5 text-sm text-ink-tertiary hover:text-ink-secondary mb-4 transition-colors"
      >
        <ArrowLeft style={{ width: 16, height: 16 }} /> Back to Claims
      </button>

      <div className="mb-5">
        <h1 className="page-title">Submit a Claim</h1>
        <p className="page-subtitle">File a claim against your coverage</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center mb-6">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center flex-1">
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 flex items-center justify-center text-2xs font-semibold ${
                  i <= step ? "bg-brand-600 text-white" : "bg-surface-sunken text-ink-muted"
                }`}
              >
                {i < step ? <Check style={{ width: 14, height: 14 }} /> : i + 1}
              </div>
              <span className={`text-sm font-medium hidden sm:inline ${i <= step ? "text-ink" : "text-ink-faint"}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-3 ${i < step ? "bg-brand-400" : "bg-border-subtle"}`} />
            )}
          </div>
        ))}
      </div>

      <div className="card p-4 sm:p-6">
        {/* Step 1: Claim Type */}
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-2">
                Claim Stage
              </label>
              <div className="flex gap-0.5 bg-surface-sunken p-0.5 w-fit mb-4">
                {CLAIM_CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => {
                      setClaimCategory(cat.key);
                      update("claimType", "");
                    }}
                    className={`px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      claimCategory === cat.key
                        ? "bg-white text-ink"
                        : "text-ink-tertiary hover:text-ink-secondary"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-2">
                Claim Type
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CLAIM_TYPES.filter((t) => t.category === claimCategory).map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => update("claimType", type.value)}
                    className={`text-left p-3 border transition-colors ${
                      form.claimType === type.value
                        ? "border-brand-500 bg-brand-50"
                        : "border-border hover:border-border-strong"
                    }`}
                  >
                    <p className="text-sm font-medium text-ink">{type.label}</p>
                    <p className="text-2xs text-ink-tertiary mt-0.5">{type.description}</p>
                  </button>
                ))}
              </div>
            </div>
            {!isPreHarvest && (
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                  Warehouse Receipt
                </label>
                <select
                  value={form.warehouseReceipt}
                  onChange={(e) => update("warehouseReceipt", e.target.value)}
                  className="input-field"
                >
                  <option value="">Select receipt</option>
                  <option value="WR-2025-0041">WR-2025-0041 — 1,500 kg @ Eldoret Central</option>
                  <option value="WR-2025-0042">WR-2025-0042 — 950 kg @ Kitale Grain Depot</option>
                </select>
              </div>
            )}
            {isPreHarvest && (
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                  Field Location
                </label>
                <input
                  type="text"
                  placeholder="e.g. Kiminini Ward, Trans Nzoia"
                  value={form.fieldLocation}
                  onChange={(e) => update("fieldLocation", e.target.value)}
                  className="input-field"
                />
              </div>
            )}
          </div>
        )}

        {/* Step 2: Details & Evidence */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                  {isPreHarvest ? "Date Event Began" : "Date of Event"}
                </label>
                <input
                  type="date"
                  value={form.dateOfEvent}
                  onChange={(e) => update("dateOfEvent", e.target.value)}
                  className="input-field"
                />
              </div>
              {isPreHarvest ? (
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                    Acreage Affected
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 2.5"
                    value={form.acreageAffected}
                    onChange={(e) => update("acreageAffected", e.target.value)}
                    className="input-field"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                    Quantity Affected (kg)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 150"
                    value={form.quantityAffectedKg}
                    onChange={(e) => update("quantityAffectedKg", e.target.value)}
                    className="input-field"
                  />
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                Estimated Loss (KSh)
              </label>
              <input
                type="number"
                placeholder="e.g. 8500"
                value={form.estimatedLossKsh}
                onChange={(e) => update("estimatedLossKsh", e.target.value)}
                className="input-field tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                Description of Event
              </label>
              <textarea
                rows={4}
                placeholder={isPreHarvest
                  ? "Describe the weather event, crop conditions, impact observed, and any local verification..."
                  : "Describe what happened, when it was discovered, and the impact on your stored grain..."
                }
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                className="input-field resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                Supporting Evidence (Optional)
              </label>
              <div className="border border-dashed border-border-strong p-6 text-center cursor-pointer hover:border-brand-400 transition-colors">
                <Upload style={{ width: 20, height: 20 }} className="text-ink-muted mx-auto mb-2" />
                <p className="text-sm text-ink-tertiary">
                  {isPreHarvest
                    ? "Upload field photos, weather reports, or agronomist assessments"
                    : "Upload photos or inspection reports"
                  }
                </p>
                <p className="text-2xs text-ink-faint mt-1">JPG, PNG, PDF up to 10MB</p>
              </div>
            </div>
            {isPreHarvest && (
              <div className="flex items-start gap-2 p-3 bg-status-info-surface text-sm text-status-info">
                <AlertCircle style={{ width: 16, height: 16 }} className="mt-0.5 flex-shrink-0" />
                <p>
                  Pre-harvest claims are validated against satellite imagery (NDVI), weather station data,
                  and rainfall records. A field verification visit may be scheduled.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Review */}
        {step === 2 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink mb-2">Review your claim</h3>
            {[
              { label: "Claim Stage", value: isPreHarvest ? "Pre-Harvest" : "Post-Harvest" },
              { label: "Claim Type", value: selectedType?.label ?? "—" },
              ...(isPreHarvest
                ? [
                    { label: "Field Location", value: form.fieldLocation || "—" },
                    { label: "Acreage Affected", value: form.acreageAffected ? `${form.acreageAffected} acres` : "—" },
                  ]
                : [
                    { label: "Warehouse Receipt", value: form.warehouseReceipt },
                    { label: "Quantity Affected", value: form.quantityAffectedKg ? `${form.quantityAffectedKg} kg` : "—" },
                  ]
              ),
              { label: "Date of Event", value: form.dateOfEvent },
              { label: "Estimated Loss", value: form.estimatedLossKsh ? `KSh ${Number(form.estimatedLossKsh).toLocaleString()}` : "—" },
              { label: "Description", value: form.description },
            ].map((row) => (
              <div key={row.label} className="flex justify-between py-2.5 border-b border-border-subtle last:border-0">
                <span className="text-sm text-ink-tertiary">{row.label}</span>
                <span className="text-sm font-medium text-ink max-w-[60%] text-right">{row.value || "—"}</span>
              </div>
            ))}

            <div className="flex items-start gap-2 p-3 bg-status-info-surface text-sm text-status-info mt-4">
              <AlertCircle style={{ width: 16, height: 16 }} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium mb-0.5">What happens next</p>
                <p>
                  {isPreHarvest
                    ? "Your claim will be validated against satellite imagery, weather station data, and rainfall records. A field verification visit may be scheduled. You’ll receive SMS updates."
                    : "Your claim will be validated against storage records and warehouse data. You’ll receive SMS and email updates on each step of the review."
                  }
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border-subtle">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="flex items-center gap-1.5 text-sm font-medium text-ink-tertiary hover:text-ink-secondary transition-colors"
            >
              <ArrowLeft style={{ width: 16, height: 16 }} /> Back
            </button>
          ) : (
            <div />
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setStep((s) => s + 1)}
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2"
            >
              Next <ArrowRight style={{ width: 15, height: 15 }} />
            </button>
          ) : (
            <div className="flex items-center gap-3">
              {submitError && (
                <span className="text-sm text-status-danger">{submitError}</span>
              )}
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className="btn-primary px-5 py-2"
              >
                {submitting ? "Submitting..." : "Submit Claim"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
