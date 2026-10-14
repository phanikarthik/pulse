import { requireCompleteProfile } from "@/lib/session";
import { QuestionView } from "./QuestionView";

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCompleteProfile();
  const { id } = await params;
  return <QuestionView id={id} />;
}
