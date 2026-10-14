import type { Metadata } from "next";
import { requireCompleteProfile } from "@/lib/session";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = { title: "Your questions" };

export default async function DashboardPage() {
  await requireCompleteProfile();
  return <Dashboard />;
}
