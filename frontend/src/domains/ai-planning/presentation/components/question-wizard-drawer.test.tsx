import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

const drawerRootProps: Array<Record<string, unknown>> = [];

mock.module("vaul", () => ({
  Drawer: {
    Root: ({ children, ...props }: ComponentProps<"div">) => {
      drawerRootProps.push(props);
      return <div data-testid="drawer-root">{children}</div>;
    },
    Portal: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="drawer-portal">{children}</div>
    ),
    Overlay: (props: ComponentProps<"div">) => <div data-testid="drawer-overlay" {...props} />,
    Content: ({ children, ...props }: ComponentProps<"div">) => (
      <div data-testid="drawer-content" {...props}>
        {children}
      </div>
    ),
    Handle: (props: ComponentProps<"div">) => <div data-testid="drawer-handle" {...props} />,
    Title: ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
    Description: ({ children, ...props }: ComponentProps<"div">) => (
      <div {...props}>{children}</div>
    ),
  },
}));

mock.module("./question-wizard", () => ({
  QuestionWizard: ({ questionText }: { questionText: string }) => (
    <div data-testid="question-wizard">{questionText}</div>
  ),
}));

const { QuestionWizardDrawer } = await import("./question-wizard-drawer");

const renderDrawer = (
  pendingQuestion: ComponentProps<typeof QuestionWizardDrawer>["pendingQuestion"],
) => (
  <QuestionWizardDrawer
    key={pendingQuestion.questionId}
    pendingQuestion={pendingQuestion}
    onAnswerQuestion={() => {}}
    isStreaming={false}
  />
);

describe("QuestionWizardDrawer", () => {
  it("arranca expandido cuando aparece una pregunta pendiente en mobile", () => {
    render(
      renderDrawer({
        questionId: "question-1",
        questionText: "¿Qué alcance quieres aprobar?",
        options: ["A", "B"],
        questionType: "single_choice",
      }),
    );

    expect(drawerRootProps).toHaveLength(1);
    expect(drawerRootProps[0]?.activeSnapPoint).toBe(0.7);
    expect(screen.getByTestId("question-wizard")).toBeInTheDocument();
    expect(screen.queryByText("Pregunta pendiente")).not.toBeInTheDocument();
  });

  it("vuelve a expandirse cuando cambia la pregunta pendiente", () => {
    const { rerender } = render(
      renderDrawer({
        questionId: "question-1",
        questionText: "Primera pregunta",
        options: ["A"],
        questionType: "single_choice",
      }),
    );

    const setActiveSnapPoint = drawerRootProps[0]?.setActiveSnapPoint as
      | ((value: number | string | null) => void)
      | undefined;

    setActiveSnapPoint?.(0.08);

    rerender(
      renderDrawer({
        questionId: "question-2",
        questionText: "Segunda pregunta",
        options: ["B"],
        questionType: "single_choice",
      }),
    );

    expect(drawerRootProps.at(-1)?.activeSnapPoint).toBe(0.7);
    expect(screen.getByTestId("question-wizard")).toHaveTextContent("Segunda pregunta");
  });
});
