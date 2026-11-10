import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/session";
import { HostConsole } from "./HostConsole";

export const metadata: Metadata = { title: "Pulse Live", robots: { index: false, follow: false } };

export default async function HostPage() {
  if (!(await getProfile())) redirect("/");
  return <HostConsole />;
}
