"use client";
/**
 * Every account action the UI can take. Components call only these functions, never
 * Supabase directly. The database decides what is allowed (RLS, triggers, RPCs).
 */
import { createClient } from "./supabase/client";
import type { AgeBand } from "./types";

type Result = { ok: true } | { ok: false; error: string };

const fail = (error: { message: string }): Result => ({
  ok: false,
  error: error.message || "Something went wrong. Please try again.",
});

/**
 * The only way in. Supabase creates the account on first sign-in; the database's signup
 * trigger copies Google's name into `profiles` and always sets role = 'voter'. Region, age
 * band and consent are then collected on /complete-profile (see completeProfile below).
 */
export async function signInWithGoogle(): Promise<Result> {
  const { error } = await createClient().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      queryParams: { prompt: "select_account" }, // let people pick which Google account
    },
  });
  return error ? fail(error) : { ok: true };
}

export async function signOut() {
  await createClient().auth.signOut();
  window.location.assign("/");
}

/** RLS limits this to the caller's own row, and column grants keep `role` out of reach. */
export async function updateProfile(userId: string, p: { displayName: string; region: string; ageBand: AgeBand }): Promise<Result> {
  const { error } = await createClient()
    .from("profiles")
    .update({ display_name: p.displayName, region: p.region, age_band: p.ageBand })
    .eq("id", userId);
  return error ? fail(error) : { ok: true };
}

/** Google sign-ups: add what the sign-up form would have collected. */
export async function completeProfile(p: { displayName: string; region: string; ageBand: AgeBand }): Promise<Result> {
  const { error } = await createClient().rpc("complete_profile", {
    p_display_name: p.displayName,
    p_region: p.region,
    p_age_band: p.ageBand,
    p_adult: true,
    p_consent: true,
  });
  return error ? fail(error) : { ok: true };
}

/** Deletes the auth user; the database cascades to the profile and votes and fixes the counts. */
export async function deleteAccount(): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) return fail(error);
  await supabase.auth.signOut({ scope: "local" });
  window.location.assign("/");
  return { ok: true };
}
