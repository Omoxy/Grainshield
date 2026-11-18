/**
 * SWR hooks for policy data.
 */
import useSWR from "swr";
import { fetcher } from "@/lib/api/client";

export interface Policy {
  id: string;
  contract_id: string;
  farmer_gs_number: string;
  farmer_name?: string;
  sub_county?: string;
  bags: number;
  grain_grade?: string;
  insured_value: number;
  premium: number;
  status: string;
  blockchain_hash?: string;
  tx_hash?: string;
  coverage_days_left?: number;
  start_date?: string;
  end_date?: string;
  expires_at?: string;
  created_at?: string;
}

interface PolicyListResponse {
  policies: Policy[];
  total_count: number;
  page: number;
  limit: number;
}

/** Fetch paginated policy list. */
export function usePolicies(page = 1, limit = 20, status?: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (status) params.set("status", status);

  return useSWR<PolicyListResponse>(
    `/api/policies?${params.toString()}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 },
  );
}

/** Fetch aggregate policy stats for admin operations view. */
export function usePolicyStats() {
  return useSWR<Record<string, unknown>>(
    "/api/policies?type=stats",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );
}
