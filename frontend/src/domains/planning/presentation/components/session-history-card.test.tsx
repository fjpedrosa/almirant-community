import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { SessionHistoryCard } from "./session-history-card";
import type { PlanningSession } from "../../domain/types";

const session: PlanningSession = {
  id: "planning-1",
  projectId: "project-1",
  boardId: null,
  organizationId: "org-1",
  title: "Checkout planning",
  status: "active",
  config: null,
  result: null,
  seedCount: 3,
  workItemCount: 5,
  createdByUserId: "user-1",
  createdByUserName: "Jane Doe",
  createdByUserImage: null,
  completedAt: null,
  totalInputTokens: null,
  totalOutputTokens: null,
  estimatedCost: null,
  durationMs: 180_000,
  createdAt: "2026-04-12T09:00:00.000Z",
  updatedAt: "2026-04-12T09:03:00.000Z",
  projectName: "Almirant",
  boardName: null,
};

describe("SessionHistoryCard", () => {
  it("muestra el usuario creador debajo del título de la sesión", () => {
    render(
      <SessionHistoryCard
        session={session}
        formattedDate="hace 5 minutos"
        formattedDuration="3m"
        onClick={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText("Checkout planning")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("muestra Unknown cuando no sabemos qué usuario lanzó la sesión", () => {
    render(
      <SessionHistoryCard
        session={{
          ...session,
          id: "planning-2",
          createdByUserId: null,
          createdByUserName: null,
          createdByUserImage: null,
        }}
        formattedDate="hace 2 minutos"
        formattedDuration="1m"
        onClick={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("U")).toBeInTheDocument();
  });
});
