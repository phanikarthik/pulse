"use client";
/**
 * India's states/UTs and districts (LGD list, in the `states` and `districts` tables). Readable
 * signed out, so the sign-up form can use them. Each list is fetched once per page load.
 */
import { createClient } from "./supabase/client";

export type Place = { code: number; name: string };

const cache = new Map<string, Promise<Place[]>>();

function cached(key: string, load: () => Promise<Place[]>) {
  if (!cache.has(key)) cache.set(key, load().catch((e) => (cache.delete(key), Promise.reject(e))));
  return cache.get(key)!;
}

export const fetchStates = () =>
  cached("states", async () => {
    const { data, error } = await createClient().from("states").select("code, name").order("name");
    if (error) throw error;
    return data;
  });

export const fetchDistricts = (stateCode: number) =>
  cached(`districts-${stateCode}`, async () => {
    const { data, error } = await createClient()
      .from("districts")
      .select("code, name")
      .eq("state_code", stateCode)
      .order("name");
    if (error) throw error;
    return data;
  });

/** The state a district belongs to (to pre-fill the picker). */
export async function fetchStateOf(districtCode: number): Promise<number | null> {
  const { data } = await createClient().from("districts").select("state_code").eq("code", districtCode).maybeSingle();
  return data?.state_code ?? null;
}
