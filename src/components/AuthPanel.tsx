"use client";
import Link from "next/link";
import { useState } from "react";
import { signInWithGoogle } from "@/lib/auth";
import { isComplete } from "@/lib/types";
import { useProfile } from "./SessionProvider";

/** Messages for /?auth_error=… set by the /auth/callback route. */
const SIGN_IN_ERRORS: Record<string, string> = {
  expired: "That sign-in attempt expired. Please try again.",
  browser: "Sign-in has to finish in the same browser it started in. Please try again here.",
  failed: "Sign-in didn't complete. Please try again.",
};

/**
 * Google is the only way in: one click, and Supabase creates the account on first use.
 * Region, age band and consent are collected once afterwards on /complete-profile.
 */
export function AuthPanel({ authError }: { authError?: string }) {
  const profile = useProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(authError ? (SIGN_IN_ERRORS[authError] ?? SIGN_IN_ERRORS.failed) : "");

  if (profile) {
    const done = isComplete(profile);
    return (
      <div className="card auth-card">
        <p className="kicker">Welcome back</p>
        <p style={{ fontSize: "1.3rem", fontWeight: 650 }}>Signed in as {profile.displayName}.</p>
        <Link href={done ? "/dashboard" : "/complete-profile"} className="btn btn-pulse btn-block">
          {done ? "Go to your questions →" : "Finish your profile →"}
        </Link>
      </div>
    );
  }

  return (
    <div className="card auth-card">
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <h2 style={{ fontSize: "1.35rem" }}>Join the conversation</h2>
        <p className="hint">New here or coming back, it&apos;s the same button. No passwords, no emails to wait for.</p>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button
        type="button"
        className="btn btn-pulse btn-block"
        disabled={busy}
        onClick={async () => {
          setError("");
          setBusy(true);
          const res = await signInWithGoogle(); // leaves the page for Google on success
          if (!res.ok) {
            setBusy(false);
            setError(res.error);
          }
        }}
      >
        <svg className="google-g" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      <p className="hint">
        We get your name and email from Google. First time? We&apos;ll ask your region and age band once, and you
        confirm you&apos;re 18+ and accept the <Link href="/terms">Terms</Link> and{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </div>
  );
}
