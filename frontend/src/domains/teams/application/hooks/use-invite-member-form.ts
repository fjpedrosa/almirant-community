"use client";

import { useState, useCallback, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useInviteMember } from "./use-team-members";
import type { TeamRole } from "../../domain/types";

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────

const createInviteSchema = (existingEmails: string[]) =>
  z.object({
    email: z
      .string()
      .min(1, "Email is required")
      .email("Invalid email format")
      .refine(
        (email) =>
          !existingEmails.some(
            (existing) => existing.toLowerCase() === email.toLowerCase(),
          ),
        "This email is already a team member",
      ),
    role: z.enum(["owner", "admin", "member"]),
  });

type InviteFormData = z.infer<ReturnType<typeof createInviteSchema>>;

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

/**
 * Form hook for the invite-member dialog.
 *
 * Uses React Hook Form + Zod with mode: "onChange" so that validation
 * feedback is immediate. Accepts `existingEmails` so we can reject
 * addresses that already belong to a team member or have a pending
 * invitation.
 */
export const useInviteMemberForm = (existingEmails: string[] = []) => {
  const [isOpen, setIsOpen] = useState(false);
  const inviteMember = useInviteMember();

  const schema = useMemo(
    () => createInviteSchema(existingEmails),
    [existingEmails],
  );

  const form = useForm<InviteFormData>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      email: "",
      role: "member",
    },
  });

  const handleOpen = useCallback(() => {
    form.reset({ email: "", role: "member" });
    setIsOpen(true);
  }, [form]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    form.reset({ email: "", role: "member" });
  }, [form]);

  const handleEmailChange = useCallback(
    (value: string) => {
      form.setValue("email", value, { shouldValidate: true });
    },
    [form],
  );

  const handleRoleChange = useCallback(
    (value: TeamRole) => {
      form.setValue("role", value, { shouldValidate: true });
    },
    [form],
  );

  const handleSubmit = useCallback(async () => {
    const isValid = await form.trigger();
    if (!isValid) return;

    const data = form.getValues();

    try {
      await inviteMember.mutateAsync({
        email: data.email,
        role: data.role,
      });
      showToast.success(`Invitation sent to ${data.email}`);
      handleClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send invitation";
      showToast.error(message);
    }
  }, [form, inviteMember, handleClose]);

  const watchedEmail = useWatch({ control: form.control, name: "email" });
  const watchedRole = useWatch({ control: form.control, name: "role" });

  return {
    isOpen,
    email: watchedEmail,
    role: watchedRole as TeamRole,
    emailError: form.formState.errors.email?.message,
    isFormValid: form.formState.isValid,
    isPending: inviteMember.isPending,
    handleOpen,
    handleClose,
    handleEmailChange,
    handleRoleChange,
    handleSubmit,
    reset: form.reset,
  };
};
