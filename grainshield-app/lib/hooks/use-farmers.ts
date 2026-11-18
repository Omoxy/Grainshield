/**
 * SWR hooks for farmer data.
 */
import useSWR from "swr";
import { fetcher } from "@/lib/api/client";

interface FarmerResponse {
  id: string;
  gs_number: string;
  name: string;
  phone: string;
  sub_county: string;
  hectares: number;
  expected_bags: number;
  language: string;
  status: string;
  registered_by: string;
  solidarity_group_id?: string;
  created_at: string;
  updated_at: string;
}

interface FarmerListResponse {
  farmers: FarmerResponse[];
  total_count: number;
  page: number;
  limit: number;
}

/** Fetch paginated farmer list. */
export function useFarmers(subCounty?: string, page = 1, limit = 20) {
  const params = new URLSearchParams();
  if (subCounty && subCounty !== "All") params.set("sub_county", subCounty);
  params.set("page", String(page));
  params.set("limit", String(limit));
  const qs = params.toString();

  return useSWR<FarmerListResponse>(
    `/api/farmers?${qs}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 },
  );
}

/** Fetch a single farmer by GS number. */
export function useFarmerByGS(gsNumber: string | null) {
  return useSWR<FarmerResponse>(
    gsNumber ? `/api/farmers/${gsNumber}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
}
