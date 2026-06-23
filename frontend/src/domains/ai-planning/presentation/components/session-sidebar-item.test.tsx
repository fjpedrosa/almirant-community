import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => {
    if (key === "unknownCreator") return "Desconocido";
    return key;
  },
  useLocale: () => "en",
}));

const { SessionSidebarItem } = await import("./session-sidebar-item");

describe("SessionSidebarItem", () => {
  it("muestra el usuario que lanzó la planificación", () => {
    render(
      <SessionSidebarItem
        id="session-1"
        title="Sesión de planificación"
        relativeDate="hace 5 minutos"
        creatorName="Alex Rivera"
        creatorImage={null}
        isActive={false}
        canResume={false}
        status="active"
        onClick={() => {}}
        onDelete={() => {}}
        onResume={() => {}}
      />,
    );

    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    expect(screen.getByText("AR")).toBeInTheDocument();
  });

  it("muestra fallback Desconocido cuando no hay usuario resuelto", () => {
    render(
      <SessionSidebarItem
        id="session-2"
        title="Sesión sin usuario"
        relativeDate="hace 2 minutos"
        creatorName={null}
        creatorImage={null}
        isActive={false}
        canResume={false}
        status="completed"
        onClick={() => {}}
        onDelete={() => {}}
        onResume={() => {}}
      />,
    );

    expect(screen.getByText("Desconocido")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
  });
});
