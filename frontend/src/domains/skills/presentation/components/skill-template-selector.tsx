import { Sparkles, PenLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { SkillTemplate } from "../../domain/skill-templates";

interface SkillTemplateSelectorProps {
  templates: SkillTemplate[];
  onSelect: (template: SkillTemplate) => void;
  onAiAssistantSelect?: () => void;
}

export const SkillTemplateSelector = ({
  templates,
  onSelect,
  onAiAssistantSelect,
}: SkillTemplateSelectorProps) => {
  const customTemplate = templates.find((t) => t.id === "custom");

  return (
    <div className="space-y-4">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Create a new skill</h3>
        <p className="text-sm text-muted-foreground">
          Write it yourself or let AI help you build it
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {/* Write from scratch */}
        {customTemplate && (
          <Card
            className="cursor-pointer transition-all duration-200 hover:border-primary hover:shadow-md py-4"
            onClick={() => onSelect(customTemplate)}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <PenLine className="h-5 w-5" />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="font-medium leading-none">From Scratch</p>
                  <p className="text-sm text-muted-foreground">
                    Write the skill content directly in the editor
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Assistant */}
        {onAiAssistantSelect && (
          <Card
            className="cursor-pointer transition-all duration-200 hover:border-primary hover:shadow-md py-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 border-purple-200 dark:border-purple-800"
            onClick={onAiAssistantSelect}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 text-white">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="font-medium leading-none">AI Assistant</p>
                  <p className="text-sm text-muted-foreground">
                    Create a skill with AI guidance through a conversation
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
