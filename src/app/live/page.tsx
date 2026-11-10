import type { Metadata } from "next";
import { JoinLive } from "./JoinLive";

export const metadata: Metadata = { title: "Join a live poll" };

export default function JoinLivePage() {
  return <JoinLive />;
}
