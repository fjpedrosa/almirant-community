import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const loadTemplateModule = async () => import("./contact-notification");

beforeEach(() => {
  mock.restore();
});

afterEach(() => {
  mock.restore();
});

describe("buildContactNotificationSubject", () => {
  it("returns subject with email and reason label", async () => {
    const { buildContactNotificationSubject } = await loadTemplateModule();
    const subject = buildContactNotificationSubject({
      email: "user@example.com",
      reason: "general",
    });
    expect(subject).toBe("New contact from user@example.com — General Inquiry");
  });

  it("falls back to raw reason when label is unknown", async () => {
    const { buildContactNotificationSubject } = await loadTemplateModule();
    const subject = buildContactNotificationSubject({
      email: "user@example.com",
      reason: "custom-reason",
    });
    expect(subject).toContain("custom-reason");
  });
});

describe("buildContactNotificationHtml", () => {
  const baseParams = {
    email: "user@example.com",
    reason: "support",
    message: "I need help with my account.",
    submissionId: "cs-123",
    ipAddress: "1.2.3.4",
    createdAt: new Date("2026-01-15T10:00:00Z").toISOString(),
  };

  it("returns valid HTML containing email, reason, and message", async () => {
    const { buildContactNotificationHtml } = await loadTemplateModule();
    const html = buildContactNotificationHtml(baseParams);

    expect(html).toContain("user@example.com");
    expect(html).toContain("Support");
    expect(html).toContain("I need help with my account.");
    expect(html).toContain("cs-123");
    expect(html).toContain("1.2.3.4");
  });

  it("HTML-escapes user input to prevent XSS", async () => {
    const { buildContactNotificationHtml } = await loadTemplateModule();
    const html = buildContactNotificationHtml({
      ...baseParams,
      message: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("converts newlines to <br /> in message", async () => {
    const { buildContactNotificationHtml } = await loadTemplateModule();
    const html = buildContactNotificationHtml({
      ...baseParams,
      message: "Line one\nLine two",
    });

    expect(html).toContain("Line one<br />Line two");
  });

  it("omits IP when ipAddress is null", async () => {
    const { buildContactNotificationHtml } = await loadTemplateModule();
    const html = buildContactNotificationHtml({
      ...baseParams,
      ipAddress: null,
    });

    expect(html).not.toContain("IP:");
  });
});
