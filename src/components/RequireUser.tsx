"use client";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";

/** Client-side guard for the stubbed session. Replaced by server-side session checks later. */
export function RequireUser({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const s = useStore();
  const router = useRouter();
  useEffect(() => {
    if (s && !s.user) router.replace("/");
  }, [s, router]);
  if (!s || !s.user) return <>{fallback ?? null}</>;
  return <>{children}</>;
}
