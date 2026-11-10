import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/session";
import { Presenter } from "./Presenter";

export const metadata: Metadata = { title: "Presenter screen", robots: { index: false, follow: false } };

export default async function PresenterPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getProfile())) redirect("/");
  const { id } = await params;
  return <Presenter id={id} />;
}
