import type { Metadata } from "next";
import { LivePollView } from "./LivePollView";

export const metadata: Metadata = { title: "Live poll", robots: { index: false, follow: false } };

export default async function LivePollPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <LivePollView code={code.toUpperCase()} />;
}
