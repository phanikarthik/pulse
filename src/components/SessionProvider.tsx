"use client";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

const SessionContext = createContext<Profile | null>(null);

/**
 * Holds the profile the server loaded for this request. When the session changes in
 * another tab (sign in / sign out), refresh so the server renders with the new session.
 */
export function SessionProvider({ profile, children }: { profile: Profile | null; children: ReactNode }) {
  const router = useRouter();
  const userId = profile?.id ?? null;

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if ((session?.user.id ?? null) !== userId) router.refresh();
    });
    return () => subscription.unsubscribe();
  }, [router, userId]);

  return <SessionContext.Provider value={profile}>{children}</SessionContext.Provider>;
}

/** The signed-in user's profile, or null when signed out. */
export function useProfile() {
  return useContext(SessionContext);
}
