declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackGoogleAdsConversion(): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;

  window.gtag("event", "conversion", {
    send_to: "AW-18009358439/1tTCCJq5wo0cEOeAxItD",
    value: 1.0,
    currency: "CHF",
  });
}
