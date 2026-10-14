import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where sign-in links (email) and Google send people back to. Exchanges the one-time
 * code for a session cookie, then continues to `next` (same-site paths only).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const nextParam = params.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  const back = (reason: string) => NextResponse.redirect(new URL(`/?auth_error=${reason}`, url.origin));

  // Supabase reports expired or already-used links this way.
  if (params.get("error")) return back(params.get("error_code") === "otp_expired" ? "expired" : "failed");

  const supabase = await createClient();
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // The code verifier cookie lives in the browser that asked for the link.
    if (error) return back(/verifier/i.test(error.message) ? "browser" : "expired");
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return back("expired");
  } else {
    return back("failed");
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
