import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const lifecycle = {
  pageOpened: mock(() => {}),
  submit: mock(async <T,>(callback: () => Promise<T>) => callback()),
};
const signUpWithEmail = mock(async () => ({ error: { message: "rejected" } }));
const publicSignupSearchParams = new URLSearchParams();

mock.module("next/navigation", () => ({
  useSearchParams: () => publicSignupSearchParams,
}));

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

mock.module("../../application/hooks/use-auth", () => ({
  useAuth: () => ({
    signInWithEmail: mock(async () => ({ error: null })),
    signUpWithEmail,
    signInWithGoogle: mock(() => {}),
    signInWithGithub: mock(() => {}),
    isLoading: false,
  }),
}));

mock.module("../../application/lib/signup-lifecycle", () => ({
  notifyPublicSignupPageOpened: lifecycle.pageOpened,
  submitSignupWithLifecycle: lifecycle.submit,
}));

mock.module("../components/sign-in-card", () => ({
  SignInCard: ({
    onSubmit,
    onValueChange,
  }: {
    onSubmit: () => Promise<void>;
    onValueChange: (
      field: "name" | "email" | "password" | "confirmPassword",
      value: string,
    ) => void;
  }) => (
    <>
      <input
        aria-label="Name"
        onChange={(event) => onValueChange("name", event.target.value)}
      />
      <input
        aria-label="Email"
        onChange={(event) => onValueChange("email", event.target.value)}
      />
      <input
        aria-label="Password"
        onChange={(event) => onValueChange("password", event.target.value)}
      />
      <input
        aria-label="Confirm password"
        onChange={(event) => onValueChange("confirmPassword", event.target.value)}
      />
      <button type="button" onClick={() => void onSubmit()}>
        Submit
      </button>
    </>
  ),
}));

const { SignInContainer } = await import("./sign-in-container");

beforeEach(() => {
  lifecycle.pageOpened.mockClear();
  lifecycle.submit.mockClear();
  signUpWithEmail.mockClear();
});

afterEach(() => {
  mock.restore();
});

const submitValidCredentials = () => {
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "User" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
    target: { value: "user@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "password123" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "password123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
};

describe("SignInContainer public signup lifecycle", () => {
  it("notifies page intake and routes public submissions through the lifecycle", async () => {
    render(<SignInContainer mode="sign_up" isPublicSignUp />);

    expect(lifecycle.pageOpened).toHaveBeenCalledWith();

    submitValidCredentials();

    await waitFor(() => expect(lifecycle.submit).toHaveBeenCalledTimes(1));
    expect(signUpWithEmail).toHaveBeenCalledTimes(1);
  });

  it("does not emit public lifecycle notifications for invitation signup", async () => {
    render(<SignInContainer mode="sign_up" isPublicSignUp={false} />);

    expect(lifecycle.pageOpened).not.toHaveBeenCalled();

    submitValidCredentials();

    await waitFor(() => expect(signUpWithEmail).toHaveBeenCalledTimes(1));
    expect(lifecycle.submit).not.toHaveBeenCalled();
  });
});
