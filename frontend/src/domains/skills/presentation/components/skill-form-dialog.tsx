import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import type {
  SkillFormDialogProps,
  CreateSkillRequest,
} from "../../domain/types";
import { SKILL_TEMPLATES, type SkillTemplate } from "../../domain/skill-templates";
import { SkillTemplateSelector } from "./skill-template-selector";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().max(1000).optional(),
  content: z.string().min(1, "Content is required"),
});

type FormValues = z.infer<typeof schema>;

interface SkillFormDialogInnerProps extends SkillFormDialogProps {
  onFormSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
  form: ReturnType<typeof useForm<FormValues>>;
  showTemplateSelector: boolean;
  onTemplateSelect: (template: SkillTemplate) => void;
  onBackToTemplates: () => void;
}

const SkillFormDialogInner = ({
  open,
  onOpenChange,
  skill,
  isPending,
  form,
  onFormSubmit,
  showTemplateSelector,
  onTemplateSelect,
  onBackToTemplates,
}: SkillFormDialogInnerProps) => {
  const isOfficial = skill?.source === "official";
  const isEditMode = !!skill;
  const isReadOnly = isOfficial;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditMode
              ? isOfficial
                ? `View Skill: ${skill.name}`
                : "Edit Skill"
              : "New Skill"}
          </DialogTitle>
        </DialogHeader>

        {showTemplateSelector ? (
          <SkillTemplateSelector
            templates={SKILL_TEMPLATES}
            onSelect={onTemplateSelect}
          />
        ) : (
          <Form {...form}>
            <form onSubmit={onFormSubmit} className="space-y-4">
              {!isEditMode && (
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
              )}

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="my-skill"
                        {...field}
                        disabled={isReadOnly}
                      />
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
                        disabled={isReadOnly}
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
                        className="font-mono text-sm min-h-[400px] resize-y"
                        rows={20}
                        {...field}
                        disabled={isReadOnly}
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

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => onOpenChange(false)}
                >
                  {isReadOnly ? "Close" : "Cancel"}
                </Button>
                {!isReadOnly && (
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Saving..." : isEditMode ? "Save Changes" : "Create"}
                  </Button>
                )}
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export const SkillFormDialog = ({
  open,
  onOpenChange,
  skill,
  isPending,
  onSubmit,
}: SkillFormDialogProps) => {
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);

  const getDefaultValues = (): FormValues => {
    if (skill) {
      return {
        name: skill.name,
        description: skill.description ?? "",
        content: skill.content,
      };
    }
    return {
      name: "",
      description: "",
      content: "",
    };
  };

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: getDefaultValues(),
  });

  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues());
      // Show template selector only when creating a new skill
      setShowTemplateSelector(!skill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, skill]);

  const handleTemplateSelect = (template: SkillTemplate) => {
    form.setValue("content", template.content);
    form.setValue("name", template.id === "custom" ? "" : template.name.toLowerCase());
    form.setValue("description", template.id === "custom" ? "" : template.description);
    setShowTemplateSelector(false);
  };

  const handleBackToTemplates = () => {
    setShowTemplateSelector(true);
  };

  const handleSubmit = form.handleSubmit((values) => {
    const data: CreateSkillRequest = {
      name: values.name,
      description: values.description || undefined,
      content: values.content,
    };

    onSubmit(data);
  });

  return (
    <SkillFormDialogInner
      open={open}
      onOpenChange={onOpenChange}
      skill={skill}
      isPending={isPending}
      onSubmit={onSubmit}
      form={form}
      onFormSubmit={handleSubmit}
      showTemplateSelector={showTemplateSelector}
      onTemplateSelect={handleTemplateSelect}
      onBackToTemplates={handleBackToTemplates}
    />
  );
};
