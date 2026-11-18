/**
 * SWR hooks for claims data.
 */
import useSWR from "swr";
import { fetcher } from "@/lib/api/client";

export interface Claim {
  id: string;
  policy_id: string;
  contract_id?: string;
  farmer_gs_number?: string;
  sub_county?: string;
  trigger_type: string;
  trigger_date?: string;
  payout_amount: number;
  status: string;
  turnaround_hours?: number;
  processing_hours?: number;
  created_at?: string;
}

interface ClaimsResponse {
  claims: Claim[];
  page: number;
  limit: number;
}

/** Fetch paginated claims list. */
export function useClaims(page = 1, limit = 20) {
  return useSWR<ClaimsResponse>(
    `/api/claims?page=${page}&limit=${limit}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 },
  );
}
