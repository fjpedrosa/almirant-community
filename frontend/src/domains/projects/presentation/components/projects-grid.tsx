"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderKanban } from "lucide-react";
import { ProjectCard } from "./project-card";
import { buildProjectScreenshotImageUrl } from "../../application/hooks/project-screenshot-url";
import type { ProjectGithubInfo, ProjectsGridProps } from "../../domain/types";

export const ProjectsGrid: React.FC<ProjectsGridProps> = ({
  projects,
  isLoading,
  onProjectHover,
  onProjectHoverEnd,
}) => {
  const t = useTranslations("projects");

  if (isLoading) {
    return (
      <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[320px] sm:h-[360px]" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="py-12 text-center">
        <FolderKanban className="mx-auto mb-4 h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-lg font-medium">{t("noProjects")}</h3>
        <p className="text-muted-foreground">{t("noProjectsHint")}</p>
      </div>
    );
  }

  return (
    <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map((project) => {
        const projectWithGithub = project as typeof project & {
          github?: ProjectGithubInfo | null;
        };
        const coverImageUrl = buildProjectScreenshotImageUrl(
          project.id,
          project.screenshotUrl,
        );

        return (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            prefetch={true}
            className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onMouseEnter={() => onProjectHover?.(project.id)}
            onMouseLeave={() => onProjectHoverEnd?.()}
          >
            <ProjectCard
              name={project.name}
              description={project.description}
              coverImageUrl={coverImageUrl}
              color={project.color}
              status={project.status}
              workItemsCount={project.workItemsCount}
              completedItemsCount={project.completedItemsCount}
              clientName={project.clientName}
              techStack={project.techStack}
              github={projectWithGithub.github}
              organizationName={project.organizationName}
              epicCount={project.epicCount}
              featureCount={project.featureCount}
              storyCount={project.storyCount}
              taskCount={project.taskCount}
              completedTaskCount={project.completedTaskCount}
            />
          </Link>
        );
      })}
    </div>
  );
};
