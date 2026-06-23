"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import type { ChangePasswordFormValues } from "../../domain/types";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const INITIAL_VALUES: ChangePasswordFormValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export const useChangePassword = () => {
  const t = useTranslations("settings");
  const [values, setValues] =
    useState<ChangePasswordFormValues>(INITIAL_VALUES);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => {
    if (!values.currentPassword) {
      return t("security.errors.currentRequired");
    }

    if (values.newPassword.length < MIN_PASSWORD_LENGTH) {
      return t("security.errors.tooShort");
    }

    if (values.newPassword.length > MAX_PASSWORD_LENGTH) {
      return t("security.errors.tooLong");
    }

    if (values.newPassword === values.currentPassword) {
      return t("security.errors.samePassword");
    }

    if (values.newPassword !== values.confirmPassword) {
      return t("security.errors.mismatch");
    }

    return null;
  }, [t, values.confirmPassword, values.currentPassword, values.newPassword]);

  const handleValueChange = useCallback(
    (field: keyof ChangePasswordFormValues, value: string) => {
      setValues((current) => ({ ...current, [field]: value }));
      setError(null);
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await authClient.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
      });

      if (result.error) {
        setError(result.error.message ?? t("security.updateError"));
        showToast.error(t("security.updateError"));
        return;
      }

      setValues(INITIAL_VALUES);
      showToast.success(t("security.updated"));
    } catch {
      setError(t("security.updateError"));
      showToast.error(t("security.updateError"));
    } finally {
      setIsSubmitting(false);
    }
  }, [t, validationError, values.currentPassword, values.newPassword]);

  return {
    values,
    isSubmitting,
    error,
    handleValueChange,
    handleSubmit,
  };
};
