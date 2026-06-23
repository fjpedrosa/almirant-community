import { describe, expect, it, mock } from "bun:test";
import { act, renderHook } from "@testing-library/react";

const changePassword = mock(async () => ({ data: { status: true }, error: null }));
const successToast = mock(() => {});
const errorToast = mock(() => {});

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

mock.module("@/lib/auth-client", () => ({
  authClient: {
    changePassword,
  },
}));

mock.module("@/domains/shared/presentation/utils/show-toast", () => ({
  showToast: {
    success: successToast,
    error: errorToast,
  },
}));

describe("useChangePassword", () => {
  it("cambia la contraseña revocando otras sesiones", async () => {
    const { useChangePassword } = await import("./use-change-password");
    const { result } = renderHook(() => useChangePassword());

    act(() => {
      result.current.handleValueChange("currentPassword", "old-password");
      result.current.handleValueChange("newPassword", "new-password");
      result.current.handleValueChange("confirmPassword", "new-password");
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password",
      revokeOtherSessions: true,
    });
    expect(successToast).toHaveBeenCalledWith("security.updated");
    expect(result.current.values).toEqual({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
  });

  it("bloquea el submit si la confirmación no coincide", async () => {
    changePassword.mockClear();
    const { useChangePassword } = await import("./use-change-password");
    const { result } = renderHook(() => useChangePassword());

    act(() => {
      result.current.handleValueChange("currentPassword", "old-password");
      result.current.handleValueChange("newPassword", "new-password");
      result.current.handleValueChange("confirmPassword", "different-password");
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(changePassword).not.toHaveBeenCalled();
    expect(result.current.error).toBe("security.errors.mismatch");
  });
});
