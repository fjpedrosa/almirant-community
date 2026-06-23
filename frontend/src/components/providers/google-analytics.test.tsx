import { afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";

mock.module("next/script", () => ({
  default: ({
    id,
    src,
    children,
  }: {
    id?: string;
    src?: string;
    children?: React.ReactNode;
  }) => (
    <script data-testid={id} id={id} src={src}>
      {children}
    </script>
  ),
}));

const originalMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

afterEach(() => {
  if (originalMeasurementId === undefined) {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    return;
  }

  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalMeasurementId;
});

describe("GoogleAnalyticsProvider", () => {
  it("renders with Ads ID when the GA4 measurement ID is missing", async () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    const { GoogleAnalyticsProvider } = await import("./google-analytics");

    render(<GoogleAnalyticsProvider />);

    expect(screen.getByTestId("google-analytics-src")).toHaveAttribute(
      "src",
      "https://www.googletagmanager.com/gtag/js?id=AW-18009358439",
    );
    expect(screen.getByTestId("google-analytics-init")).toHaveTextContent(
      "gtag('config', 'AW-18009358439');",
    );
  });

  it("renders both GA4 and Ads configs when the measurement ID is configured", async () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "  G-TEST123  ";
    const { GoogleAnalyticsProvider } = await import("./google-analytics");

    render(<GoogleAnalyticsProvider />);

    expect(screen.getByTestId("google-analytics-src")).toHaveAttribute(
      "src",
      "https://www.googletagmanager.com/gtag/js?id=G-TEST123",
    );
    expect(screen.getByTestId("google-analytics-init")).toHaveTextContent(
      "gtag('config', 'AW-18009358439');",
    );
    expect(screen.getByTestId("google-analytics-init")).toHaveTextContent(
      "gtag('config', 'G-TEST123');",
    );
  });
});
