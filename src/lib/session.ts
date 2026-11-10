import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { isComplete, type AgeBand, type HostStatus, type Profile, type Role } from "./types";

/**
 * The signed-in member's profile, or null. Pulse Live guests (anonymous sign-ins) count as
 * signed out everywhere except their live poll. Cached per request (layout and page share one lookup).
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return null;

  const [{ data }, { data: host }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, district_code, region, age_band, consented_at, role, created_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("hosts").select("status").eq("user_id", user.id).maybeSingle(),
  ]);

  return {
    id: user.id,
    email: user.email ?? "",
    displayName: data?.display_name ?? user.email?.split("@")[0] ?? "Voter",
    districtCode: data?.district_code ?? null,
    region: data?.region ?? null,
    ageBand: (data?.age_band as AgeBand | null) ?? null,
    consented: !!data?.consented_at,
    role: (data?.role as Role | undefined) ?? "voter",
    isHost: host?.status === "approved",
    hostStatus: (host?.status as HostStatus | undefined) ?? null,
    createdAt: data?.created_at ?? user.created_at,
  };
});

/** For voter pages: signed out → welcome page; profile incomplete → finish it first. */
export async function requireCompleteProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/");
  if (!isComplete(profile)) redirect("/complete-profile");
  return profile;
}
