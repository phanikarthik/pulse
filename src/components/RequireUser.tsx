"use client";
import type { ReactNode } from "react";
import { useStore } from "@/lib/demo-store";

/**
 * Voter pages are already protected on the server (middleware + requireCompleteProfile).
 * This only waits for the browser-side sample data to load before rendering.
 */
export function RequireUser({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const s = useStore();
  if (!s) return <>{fallback ?? null}</>;
  return <>{children}</>;
}
