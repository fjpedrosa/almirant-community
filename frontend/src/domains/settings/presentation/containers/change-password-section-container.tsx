"use client";

import { useChangePassword } from "../../application/hooks/use-change-password";
import { ChangePasswordSection } from "../components/change-password-section";

export const ChangePasswordSectionContainer: React.FC = () => {
  const {
    values,
    isSubmitting,
    error,
    handleValueChange,
    handleSubmit,
  } = useChangePassword();

  return (
    <ChangePasswordSection
      values={values}
      isSubmitting={isSubmitting}
      error={error}
      onValueChange={handleValueChange}
      onSubmit={handleSubmit}
    />
  );
};
