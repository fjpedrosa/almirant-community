import { redirect } from "next/navigation";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/agents?tab=sessions&jobId=${id}`);
}
