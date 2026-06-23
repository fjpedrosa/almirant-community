"use client";

import { use } from "react";
import { TeamDetailContainer } from "@/domains/teams/presentation/containers/team-detail-container";

export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <TeamDetailContainer teamId={id} />;
}
