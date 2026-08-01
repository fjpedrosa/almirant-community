import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ScheduledBadge } from "./scheduled-badge";

// Review fix (T2.1 #2) regression note: ScheduledBadge already accepted `now`
// as a prop before this fix — the actual bug was upstream, in WorkItemCard
// never passing an updated `now` down (see work-item-card.memo.test.ts and
// use-minute-now.test.ts for the tests that actually drove that fix). This
// test isn't a RED/GREEN test for THIS component; it locks in the contract
// its callers now rely on: a rerender with an advanced `now` must hide the
// badge, not just a fresh mount with different props.

// Covers the "Scheduled" badge visibility rule (gate #47 in the backend
// `selectBacklogDrainCandidates`): visible ONLY while `startDate` is set and
// still in the future relative to `now`; a past or absent start date must
// render nothing (the item is treated as a normal, immediately-eligible item).

const NOW = new Date("2026-08-01T12:00:00.000Z");

describe("ScheduledBadge", () => {
  it("renders the label when startDate is in the future", () => {
    render(
      <ScheduledBadge
        startDate="2026-08-15T00:00:00.000Z"
        label="Scheduled · in 14 days"
        now={NOW}
      />
    );

    expect(screen.getByText("Scheduled · in 14 days")).toBeInTheDocument();
  });

  it("renders nothing when startDate is in the past", () => {
    const { container } = render(
      <ScheduledBadge
        startDate="2026-07-01T00:00:00.000Z"
        label="Scheduled · 31 days ago"
        now={NOW}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when startDate is null", () => {
    const { container } = render(
      <ScheduledBadge startDate={null} label="Scheduled · never" now={NOW} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when startDate is undefined", () => {
    const { container } = render(
      <ScheduledBadge startDate={undefined} label="Scheduled · never" now={NOW} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when startDate is exactly now (not strictly future)", () => {
    const { container } = render(
      <ScheduledBadge startDate={new Date(NOW)} label="Scheduled · now" now={NOW} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("disappears when `now` advances past startDate on a rerender", () => {
    const startDate = "2026-08-15T00:00:00.000Z";
    const { container, rerender } = render(
      <ScheduledBadge startDate={startDate} label="Scheduled · in 14 days" now={NOW} />
    );

    expect(screen.getByText("Scheduled · in 14 days")).toBeInTheDocument();

    const later = new Date("2026-08-16T00:00:00.000Z");
    rerender(
      <ScheduledBadge startDate={startDate} label="Scheduled · 1 day ago" now={later} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
