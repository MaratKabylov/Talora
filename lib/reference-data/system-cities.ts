import "server-only";

import { unstable_cache } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";

export const SYSTEM_CITIES_CACHE_TAG = "reference:system-cities";

export type SystemCityReference = {
  id: string;
  is_active: boolean;
  name: string;
};

const readSystemCities = unstable_cache(
  async (): Promise<SystemCityReference[]> => {
    const { data, error } = await createAdminClient()
      .from("system_cities")
      .select("id, name, is_active")
      .order("name");

    if (error) {
      throw new Error("Unable to load system cities.");
    }

    return (data ?? []) as SystemCityReference[];
  },
  ["reference", "system-cities", "v1"],
  {
    revalidate: 60 * 60,
    tags: [SYSTEM_CITIES_CACHE_TAG],
  },
);

export async function listCachedSystemCities() {
  return readSystemCities();
}
