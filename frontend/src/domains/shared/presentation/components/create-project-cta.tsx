import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CreateProjectCtaProps } from "../../domain/types";

// Presentational component for prompting users to create their first project.
// Renders a centered card with icon, title, description and CTA button.
//
// Usage:
// <CreateProjectCta
//   title="Create your first project"
//   description="Projects help you organize boards, tasks, and documentation."
//   buttonLabel="Create Project"
// />

export const CreateProjectCta: React.FC<CreateProjectCtaProps> = ({
  title = "Create your first project",
  description = "Projects help you organize boards, tasks, and documentation in one place.",
  buttonLabel = "Create Project",
  className,
}) => {
  return (
    <Card className={cn("border-dashed", className)}>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-4">
          <FolderKanban
            className="h-7 w-7 text-primary"
            aria-hidden="true"
          />
        </div>
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-6">
          {description}
        </p>
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
            {buttonLabel}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
};
