import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChangePasswordSection } from "./change-password-section";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("ChangePasswordSection", () => {
  it("renderiza el formulario de cambio de contraseña con autocompletado seguro", () => {
    render(
      <ChangePasswordSection
        values={{
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        }}
        isSubmitting={false}
        error={null}
        onValueChange={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByText("security.title")).toBeInTheDocument();
    expect(screen.getByLabelText("security.currentPassword")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("security.newPassword")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("security.confirmPassword")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("envía los valores sin exponerlos fuera del callback controlado", () => {
    const submitted = mock(() => {});
    const onValueChange = mock(() => {});

    render(
      <ChangePasswordSection
        values={{
          currentPassword: "old-password",
          newPassword: "new-password",
          confirmPassword: "new-password",
        }}
        isSubmitting={false}
        error={null}
        onValueChange={onValueChange}
        onSubmit={submitted}
      />,
    );

    fireEvent.change(screen.getByLabelText("security.currentPassword"), {
      target: { value: "updated-old-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "security.save" }));

    expect(onValueChange).toHaveBeenCalledWith(
      "currentPassword",
      "updated-old-password",
    );
    expect(submitted).toHaveBeenCalled();
  });
});
