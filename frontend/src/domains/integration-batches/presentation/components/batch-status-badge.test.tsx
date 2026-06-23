import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { BatchStatusBadge } from "./batch-status-badge";

describe("BatchStatusBadge", () => {
  it("renders human label for 'rebasing'", () => {
    render(<BatchStatusBadge status="rebasing" />);
    expect(screen.getByText(/rebasing/i)).toBeDefined();
  });

  it("renders human label for 'merged'", () => {
    render(<BatchStatusBadge status="merged" />);
    expect(screen.getByText(/merged/i)).toBeDefined();
  });

  it("renders human label for 'failed'", () => {
    render(<BatchStatusBadge status="failed" />);
    expect(screen.getByText(/failed/i)).toBeDefined();
  });

  it("uses different visual variant for terminal vs in-progress states", () => {
    const { container: terminal } = render(<BatchStatusBadge status="merged" />);
    const { container: inFlight } = render(<BatchStatusBadge status="rebasing" />);
    // Visual differentiation: any class difference between the two states.
    const terminalClass = terminal.firstChild?.nodeType === 1 ? (terminal.firstChild as Element).className : "";
    const inFlightClass = inFlight.firstChild?.nodeType === 1 ? (inFlight.firstChild as Element).className : "";
    expect(terminalClass).not.toBe(inFlightClass);
  });
});
