import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { PiIcon } from "./pi-icon";

const FIRST_PATH =
  "M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z";
const SECOND_PATH = "M517.36 400 H634.72 V634.72 H517.36 Z";

describe("PiIcon", () => {
  it("renders the official Pi geometry in the current selector color", () => {
    const markup = renderToStaticMarkup(<PiIcon className="size-5 text-primary" />);

    expect(markup).toContain('viewBox="0 0 800 800"');
    expect(markup).toContain(`d="${FIRST_PATH}"`);
    expect(markup).toContain(`d="${SECOND_PATH}"`);
    expect(markup).toContain('fill-rule="evenodd"');
    expect(markup.match(/fill="currentColor"/g)).toHaveLength(2);
    expect(markup).toContain('class="size-5 text-primary"');
  });

  it("vendors only inert inline SVG content", () => {
    const markup = renderToStaticMarkup(<PiIcon />);

    expect(markup).not.toMatch(/<(?:script|style|foreignObject|image|use)\b/i);
    expect(markup).not.toMatch(/(?:href|xlink:href)=/i);
    expect(markup).not.toContain("url(");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
  });

  it("is decorative by default when adjacent text supplies the name", () => {
    const { container } = render(
      <span>
        <PiIcon className="h-4 w-4" />
        <span>Pi</span>
      </span>,
    );

    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Pi")).toBeInTheDocument();
  });

  it("supports either a title or label for standalone accessible use", () => {
    const titleView = render(<PiIcon title="Pi coding agent" />);

    expect(screen.getByRole("img", { name: "Pi coding agent" })).toBeInTheDocument();
    expect(titleView.container.querySelectorAll("title")).toHaveLength(1);
    expect(titleView.container.querySelector("svg")).not.toHaveAttribute("aria-label");

    titleView.unmount();
    const labelView = render(
      <PiIcon title="Ignored duplicate" aria-label="Pi standalone" />,
    );

    expect(screen.getByRole("img", { name: "Pi standalone" })).toBeInTheDocument();
    expect(labelView.container.querySelectorAll("title")).toHaveLength(0);
  });
});
