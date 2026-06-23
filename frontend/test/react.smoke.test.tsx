import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

describe("react smoke", () => {
  it("renders a component with Testing Library", () => {
    render(<button type="button">Hello</button>);
    expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
  });
});

