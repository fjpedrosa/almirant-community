"use client";

import { useCallback } from "react";
import { useSkillCreateDrawer } from "../../application/hooks/use-skill-create-drawer";
import { SkillCreateDrawer } from "../components/skill-create-drawer";

interface SkillCreateDrawerContainerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSkillCreated: (skillId: string) => void;
}

export const SkillCreateDrawerContainer = ({
  open,
  onOpenChange,
  onSkillCreated,
}: SkillCreateDrawerContainerProps) => {
  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const {
    form,
    onSubmit,
    isPending,
    mode,
    onTemplateSelect,
    onBackToTemplates,
    onAiAssistantSelect,
    onSaveFromChat,
    resetDrawer,
  } = useSkillCreateDrawer({
    onSkillCreated,
    onClose: handleClose,
  });

  // Handle open change and reset drawer when opening
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen) {
        resetDrawer();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, resetDrawer]
  );

  return (
    <SkillCreateDrawer
      open={open}
      onOpenChange={handleOpenChange}
      isPending={isPending}
      form={form}
      onSubmit={onSubmit}
      mode={mode}
      onTemplateSelect={onTemplateSelect}
      onBackToTemplates={onBackToTemplates}
      onAiAssistantSelect={onAiAssistantSelect}
      onSaveFromChat={onSaveFromChat}
    />
  );
};
