import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { WavePanel } from "./wave-panel";
import type { WavePanelInfo } from "../../domain/types";

describe("WavePanel", () => {
  it("renders nothing when waveInfo is null", () => {
    const { container } = render(<WavePanel waveInfo={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there are no agents", () => {
    const waveInfo: WavePanelInfo = { agents: [], successCount: 0, totalCount: 0 };
    const { container } = render(<WavePanel waveInfo={waveInfo} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per agent with the success/total header", () => {
    const waveInfo: WavePanelInfo = {
      agents: [
        { id: "A-425", name: "frontend-developer", role: "Drawer", done: true, success: true },
        { id: "A-426", name: "backend-architect", role: "API", done: false },
        { id: "A-427", name: "database-architect", role: "Schema", done: true, success: false },
      ],
      successCount: 1,
      totalCount: 3,
    };

    render(<WavePanel waveInfo={waveInfo} />);

    expect(screen.getByText("frontend-developer")).toBeDefined();
    expect(screen.getByText("backend-architect")).toBeDefined();
    expect(screen.getByText("database-architect")).toBeDefined();
    // Header shows aggregate success/total.
    expect(screen.getByText("1/3")).toBeDefined();
  });
});
