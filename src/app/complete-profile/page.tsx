import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/session";
import { isComplete } from "@/lib/types";
import { CompleteProfile } from "./CompleteProfile";

export const metadata: Metadata = { title: "Finish your profile" };

export default async function CompleteProfilePage() {
  const profile = await getProfile();
  if (!profile) redirect("/");
  if (isComplete(profile)) redirect("/dashboard");
  return <CompleteProfile />;
}
