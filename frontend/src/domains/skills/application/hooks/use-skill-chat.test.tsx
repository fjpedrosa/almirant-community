import React from "react";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// mock.module persists across test files inside the same bun:test process, so
// we scope the "@/lib/api/client" mock inside beforeAll/afterAll + mock.restore()
// to avoid leaking a partial shape into later tests.

const fetchMock = mock(() =>
  Promise.resolve(
    new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  )
);

globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeAll(async () => {
  // Preserve every real export from "@/lib/api/client" so later test files
  // that rely on `request`, `feedbackTriageApi`, etc. don't break.
  const actualClient = await import("@/lib/api/client");

  mock.module("@/lib/api/client", () => ({
    ...actualClient,
    API_BASE: "/api",
    getSessionToken: () => null,
  }));
});

afterAll(() => {
  mock.restore();
});

describe("useSkillChat", () => {
  it("envia el primer prompt a la ruta correcta de generacion de skills", async () => {
    fetchMock.mockClear();
    const { useSkillChat } = await import("./use-skill-chat");

    const Harness = () => {
      const { sendMessage } = useSkillChat();

      return (
        <button
          type="button"
          onClick={async () => {
            await sendMessage("Crea una skill para revisar PRs");
          }}
        >
          enviar
        </button>
      );
    };

    render(<Harness />);

    await act(async () => {
      fireEvent.click(screen.getByText("enviar"));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const firstCall = fetchMock.mock.calls.at(0) as
      | [string, RequestInit | undefined]
      | undefined;
    expect(firstCall).toBeDefined();
    expect(String(firstCall?.[0])).toBe("/api/ai/generate-skill");
  });
});
