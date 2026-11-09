import type { Metadata } from "next";
import { AdminConsole } from "../../AdminConsole";

export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminConsole questionId={id} />;
}
