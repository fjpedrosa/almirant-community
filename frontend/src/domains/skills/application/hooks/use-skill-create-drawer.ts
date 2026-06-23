"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateSkill } from "./use-skill-mutations";
import type { SkillTemplate } from "../../domain/skill-templates";
import type { CreateSkillRequest, GeneratedSkill } from "../../domain/types";

export type SkillCreateDrawerMode = "templates" | "form" | "chat";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().max(1000).optional(),
  content: z.string().min(1, "Content is required"),
});

type FormValues = z.infer<typeof schema>;

interface UseSkillCreateDrawerOptions {
  onSkillCreated: (skillId: string) => void;
  onClose: () => void;
}

export const useSkillCreateDrawer = ({
  onSkillCreated,
  onClose,
}: UseSkillCreateDrawerOptions) => {
  const [mode, setMode] = useState<SkillCreateDrawerMode>("templates");
  const createMutation = useCreateSkill();

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: {
      name: "",
      description: "",
      content: "",
    },
  });

  const resetDrawer = useCallback(() => {
    form.reset({
      name: "",
      description: "",
      content: "",
    });
    setMode("templates");
  }, [form]);

  const handleTemplateSelect = useCallback(
    (template: SkillTemplate) => {
      form.setValue("content", template.content);
      form.setValue(
        "name",
        template.id === "custom" ? "" : template.name.toLowerCase()
      );
      form.setValue(
        "description",
        template.id === "custom" ? "" : template.description
      );
      setMode("form");
    },
    [form]
  );

  const handleBackToTemplates = useCallback(() => {
    setMode("templates");
  }, []);

  const handleAiAssistantSelect = useCallback(() => {
    setMode("chat");
  }, []);

  const handleSaveFromChat = useCallback(
    (skill: GeneratedSkill) => {
      const data: CreateSkillRequest = {
        name: skill.name,
        description: skill.description || undefined,
        content: skill.content,
      };

      createMutation.mutate(data, {
        onSuccess: (createdSkill) => {
          onSkillCreated(createdSkill.id);
          onClose();
        },
      });
    },
    [createMutation, onSkillCreated, onClose]
  );

  const handleSubmit = form.handleSubmit((values) => {
    const data: CreateSkillRequest = {
      name: values.name,
      description: values.description || undefined,
      content: values.content,
    };

    createMutation.mutate(data, {
      onSuccess: (skill) => {
        onSkillCreated(skill.id);
        onClose();
      },
    });
  });

  return {
    form,
    onSubmit: handleSubmit,
    isPending: createMutation.isPending,
    mode,
    onTemplateSelect: handleTemplateSelect,
    onBackToTemplates: handleBackToTemplates,
    onAiAssistantSelect: handleAiAssistantSelect,
    onSaveFromChat: handleSaveFromChat,
    resetDrawer,
  };
};
