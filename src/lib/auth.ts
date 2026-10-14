"use client";
/**
 * Every account action the UI can take. Components call only these functions, never
 * Supabase directly. The database decides what is allowed (RLS, triggers, RPCs).
 */
import type { AuthError } from "@supabase/supabase-js";
import { clearLocalDemoData } from "./demo-store";
import { createClient } from "./supabase/client";
import type { AgeBand } from "./types";

type Result = { ok: true } | { ok: false; error: string };

const callbackUrl = (next = "/dashboard") =>
  `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

function friendly(error: AuthError | { message: string; code?: string; status?: number }): string {
  const code = "code" in error ? error.code : undefined;
  const status = "status" in error ? error.status : undefined;
  if (code === "otp_disabled" || /signups not allowed/i.test(error.message))
    return "There's no Pulse account for that email yet. Use Create account instead.";
  if (code === "otp_expired" || /token has expired or is invalid/i.test(error.message))
    return "That code is wrong or has expired. Check the latest email, or go back and send a new one.";
  if (status === 429 || code?.startsWith("over_"))
    return "Too many emails requested. Please wait a minute and try again.";
  return error.message || "Something went wrong. Please try again.";
}

const fail = (error: Parameters<typeof friendly>[0]): Result => ({ ok: false, error: friendly(error) });

/** Existing accounts only: never creates a user from the sign-in tab. */
export async function sendSignInEmail(email: string): Promise<Result> {
  const { error } = await createClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: callbackUrl() },
  });
  return error ? fail(error) : { ok: true };
}

/**
 * New account. The profile fields travel as user metadata; the database's signup trigger
 * copies them into `profiles` and always sets role = 'voter'. If the email already has an
 * account this just signs them in and the fields are ignored.
 */
export async function sendSignUpEmail(input: {
  email: string;
  displayName: string;
  region: string;
  ageBand: AgeBand;
}): Promise<Result> {
  const { error } = await createClient().auth.signInWithOtp({
    email: input.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: callbackUrl(),
      data: {
        display_name: input.displayName,
        region: input.region,
        age_band: input.ageBand,
        adult: true,
        consent: true,
      },
    },
  });
  return error ? fail(error) : { ok: true };
}

/** The one-time code from the email (only present once the email template includes it). */
export async function verifyEmailCode(email: string, code: string): Promise<Result> {
  const { error } = await createClient().auth.verifyOtp({ email, token: code, type: "email" });
  return error ? fail(error) : { ok: true };
}

/** Shown only when NEXT_PUBLIC_GOOGLE_SIGNIN=on (the Google provider must be enabled in Supabase). */
export const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "on";

export async function signInWithGoogle(): Promise<Result> {
  const { error } = await createClient().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl() },
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
  clearLocalDemoData();
  window.location.assign("/");
  return { ok: true };
}
