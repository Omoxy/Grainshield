/**
 * SWR hooks for aflatoxin risk and sensor data.
 */
import useSWR from "swr";
import { fetcher } from "@/lib/api/client";

interface RiskScore {
  id: string;
  sub_county: string;
  risk_score: number;
  risk_level: string;
  contamination_ppb: number;
  confidence: number;
  model_version: string;
  recorded_at: string;
  premium_multiplier: number;
}

interface AflatoxinResponse {
  scores: RiskScore[];
  alert_count: number;
  threshold: number;
  model: string;
  updated_at: string;
}

interface RiskOverviewResponse {
  aflatoxin_risks: { sub_county: string; score: number; level: string; premium_multiplier: number }[];
  active_sensor_alerts: number;
  recent_weather_events: Record<string, unknown>[];
}

export function useAflatoxinRisk(subCounty?: string) {
  const qs = subCounty ? `&sub_county=${encodeURIComponent(subCounty)}` : "";
  return useSWR<AflatoxinResponse>(
    `/api/risk?type=aflatoxin${qs}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );
}

export function useRiskOverview() {
  return useSWR<RiskOverviewResponse>(
    "/api/risk?type=overview",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );
}
