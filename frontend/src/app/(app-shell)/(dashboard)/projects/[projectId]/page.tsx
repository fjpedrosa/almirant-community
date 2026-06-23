"use client";

import { use } from "react";
import { ProjectDetailContainer } from "@/domains/projects/presentation/containers/project-detail-container";

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  return (
    <div className="h-full overflow-y-auto">
      <ProjectDetailContainer projectId={projectId} />
    </div>
  );
}
