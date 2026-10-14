import type { Metadata } from "next";
import { requireCompleteProfile } from "@/lib/session";
import { AccountView } from "./AccountView";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  await requireCompleteProfile();
  return <AccountView />;
}
