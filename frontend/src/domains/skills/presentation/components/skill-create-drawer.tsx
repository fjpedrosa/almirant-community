import { ArrowLeft } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { SKILL_TEMPLATES, type SkillTemplate } from "../../domain/skill-templates";
import { SkillTemplateSelector } from "./skill-template-selector";
import { SkillChatCreatorContainer } from "../containers/skill-chat-creator-container";
import type { GeneratedSkill } from "../../domain/types";
import type { SkillCreateDrawerMode } from "../../application/hooks/use-skill-create-drawer";

export interface SkillCreateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any; // UseFormReturn from react-hook-form
  onSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
  mode: SkillCreateDrawerMode;
  onTemplateSelect: (template: SkillTemplate) => void;
  onBackToTemplates: () => void;
  onAiAssistantSelect: () => void;
  onSaveFromChat: (skill: GeneratedSkill) => void;
}

export const SkillCreateDrawer = ({
  open,
  onOpenChange,
  isPending,
  form,
  onSubmit,
  mode,
  onTemplateSelect,
  onBackToTemplates,
  onAiAssistantSelect,
  onSaveFromChat,
}: SkillCreateDrawerProps) => {
  const renderContent = () => {
    switch (mode) {
      case "templates":
        return (
          <ScrollArea className="flex-1 px-6 min-h-0">
            <div className="pb-6">
              <SkillTemplateSelector
                templates={SKILL_TEMPLATES}
                onSelect={onTemplateSelect}
                onAiAssistantSelect={onAiAssistantSelect}
              />
            </div>
          </ScrollArea>
        );

      case "chat":
        return (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="px-6 pb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-2 -ml-2"
                onClick={onBackToTemplates}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to templates
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <SkillChatCreatorContainer onSaveSkill={onSaveFromChat} />
            </div>
          </div>
        );

      case "form":
        return (
          <Form {...form}>
            <form onSubmit={onSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <ScrollArea className="flex-1 px-6 min-h-0">
                <div className="space-y-4 pb-6">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-2 -ml-2"
                    onClick={onBackToTemplates}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to templates
                  </Button>

                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="my-skill" {...field} />
                        </FormControl>
                        <FormDescription>
                          A unique identifier for this skill
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Brief description of what this skill does"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="content"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Content</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Enter the skill content (markdown or text)..."
                            className="font-mono text-sm min-h-[300px] resize-y"
                            rows={15}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          The skill instructions that will be injected into the agent
                          context
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </ScrollArea>

              <SheetFooter className="border-t px-6 py-4">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Creating..." : "Create"}
                </Button>
              </SheetFooter>
            </form>
          </Form>
        );
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md w-full flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-2">
          <SheetTitle>New Skill</SheetTitle>
          <SheetDescription>
            Create a new skill to use with your agents.
          </SheetDescription>
        </SheetHeader>

        {renderContent()}
      </SheetContent>
    </Sheet>
  );
};
