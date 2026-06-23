import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "bun:test";
import { CustomToast } from "./custom-toast";

describe("CustomToast", () => {
  it("renders merged toasts with a visible violet dark-mode surface", () => {
    render(
      <CustomToast
        type="merged"
        title="PR #108 mergeada"
        description="fix(runner): route scheduled automation gates correctly"
        toastId="merged-toast"
      />,
    );

    const toast = screen.getByRole("alert");

    expect(toast.className).toContain("dark:bg-violet-500/20");
    expect(toast.className).toContain("dark:border-violet-400/50");
    expect(toast.className).not.toContain("dark:bg-violet-950");
  });
});
