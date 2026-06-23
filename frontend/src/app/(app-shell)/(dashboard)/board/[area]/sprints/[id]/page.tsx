"use client";

import { use } from "react";
import { SprintReportPageContainer } from "@/domains/sprints/presentation/containers/sprint-report-page-container";

export default function SprintReportFullPage({
  params,
}: {
  params: Promise<{ area: string; id: string }>;
}) {
  const { area, id } = use(params);
  return <SprintReportPageContainer sprintId={id} area={area} />;
}
