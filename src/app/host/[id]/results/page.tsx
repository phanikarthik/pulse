import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/session";
import { HostResults } from "./HostResults";

export const metadata: Metadata = { title: "Poll results", robots: { index: false, follow: false } };

export default async function HostResultsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getProfile())) redirect("/");
  const { id } = await params;
  return <HostResults id={id} />;
}
