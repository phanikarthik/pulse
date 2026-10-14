import { QuestionView } from "./QuestionView";

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuestionView id={id} />;
}
