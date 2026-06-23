import Link from "next/link";
import { useTranslations } from "next-intl";
import { Sparkles, Play, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmptySessionStateProps } from "../../domain/types";

// Usage:
// <EmptySessionState onStartSession={handleStart} projects={[]} selectedProjectId="" ... />

export const EmptySessionState: React.FC<EmptySessionStateProps> = ({
  onStartSession,
  isStarting = false,
  projects,
  selectedProjectId,
  isLoadingProjects,
  onProjectChange,
}) => {
  const t = useTranslations("aiPlanning");

  const isButtonDisabled = isStarting || !selectedProjectId;
  const hasNoProjects = !isLoadingProjects && projects.length === 0;

  return (
    <div className="flex-1 flex flex-col items-center gap-6 p-8 pt-24 md:pt-8 md:justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <Sparkles className="size-10 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">
          {hasNoProjects
            ? t("emptySession.noProjectsTitle")
            : t("emptySession.title")}
        </h2>
        <p className="text-base text-muted-foreground max-w-lg">
          {hasNoProjects
            ? t("emptySession.noProjectsDescription")
            : t("emptySession.description")}
        </p>
      </div>

      {hasNoProjects ? (
        <Button asChild size="lg">
          <Link href="/projects/new">
            <FolderPlus className="size-4" />
            <span className="ml-2">{t("emptySession.createProject")}</span>
          </Link>
        </Button>
      ) : (
        <>
          <div className="flex flex-col items-center gap-3 w-full max-w-xs">
            <Select
              value={selectedProjectId}
              onValueChange={onProjectChange}
              disabled={isLoadingProjects}
            >
              <SelectTrigger className="w-full h-12! md:h-10! text-base md:text-sm">
                <SelectValue placeholder={t("emptySession.selectProjectPlaceholder")} />
              </SelectTrigger>
              <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={onStartSession} disabled={isButtonDisabled} size="lg">
            <Play className="size-4" />
            <span className="ml-2">
              {isStarting
                ? t("emptySession.starting")
                : t("emptySession.startSession")}
            </span>
          </Button>
        </>
      )}
    </div>
  );
};
