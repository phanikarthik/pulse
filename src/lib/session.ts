import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { isComplete, type AgeBand, type Profile, type Role } from "./types";

/** The signed-in user's profile, or null. Cached per request (layout and page share one lookup). */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("display_name, region, age_band, consented_at, role, created_at")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? "",
    displayName: data?.display_name ?? user.email?.split("@")[0] ?? "Voter",
    region: data?.region ?? null,
    ageBand: (data?.age_band as AgeBand | null) ?? null,
    consented: !!data?.consented_at,
    role: (data?.role as Role | undefined) ?? "voter",
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
