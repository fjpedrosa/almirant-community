import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as resendModule from "resend";
import nodemailer from "nodemailer";
import { env } from "@almirant/config";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

const smtpState = {
  shouldThrow: false,
  sendCalls: [] as Array<Record<string, unknown>>,
};

const resendState = {
  shouldThrow: false,
  shouldReturnError: false,
  sendCalls: [] as Array<Record<string, unknown>>,
};

// ---------------------------------------------------------------------------
// Set up spies ONCE (not per-test) because email-service caches singletons.
// The cached transporter / Resend client will keep references to our closures
// so we control behaviour through the state objects above.
// ---------------------------------------------------------------------------

spyOn(nodemailer, "createTransport").mockReturnValue({
  sendMail: async (payload: Record<string, unknown>) => {
    smtpState.sendCalls.push(payload);
    if (smtpState.shouldThrow) throw new Error("smtp unavailable");
    return { messageId: "smtp-msg-1" };
  },
} as never);

spyOn(resendModule, "Resend" as never).mockImplementation((() => ({
  emails: {
    send: async (payload: Record<string, unknown>) => {
      resendState.sendCalls.push(payload);
      if (resendState.shouldThrow) throw new Error("resend unavailable");
      if (resendState.shouldReturnError) {
        return { error: { message: "resend api error" } };
      }
      return { data: { id: "resend-msg-1" }, error: null };
    },
  },
})) as never);

// Save originals for cleanup.
const originalEnvValues: Record<string, unknown> = {};
const envKeys = [
  "NODE_ENV",
  "EMAIL_FROM",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "RESEND_API_KEY",
] as const;

for (const key of envKeys) {
  originalEnvValues[key] = (env as Record<string, unknown>)[key];
}

describe("email-service", () => {
  beforeEach(() => {
    smtpState.shouldThrow = false;
    smtpState.sendCalls = [];
    resendState.shouldThrow = false;
    resendState.shouldReturnError = false;
    resendState.sendCalls = [];

    const e = env as Record<string, unknown>;
    e.NODE_ENV = "test";
    e.EMAIL_FROM = "Almirant <no-reply@almirant.ai>";
    e.SMTP_HOST = undefined;
    e.SMTP_PORT = 587;
    e.SMTP_SECURE = "false";
    e.SMTP_USER = undefined;
    e.SMTP_PASS = undefined;
    e.RESEND_API_KEY = undefined;
  });

  it("uses SMTP as primary provider when SMTP is configured", async () => {
    const e = env as Record<string, unknown>;
    e.SMTP_HOST = "smtp.example.com";
    e.SMTP_USER = "smtp-user";
    e.SMTP_PASS = "smtp-pass";
    e.RESEND_API_KEY = "re_test_key";

    const { sendEmail } = await import("./email-service");
    const result = await sendEmail({
      to: "test@example.com",
      subject: "smtp primary",
      html: "<p>hello</p>",
    });

    expect(result.success).toBe(true);
    expect(smtpState.sendCalls.length).toBe(1);
    expect(resendState.sendCalls.length).toBe(0);
  });

  it("falls back to Resend when SMTP send fails and Resend is configured", async () => {
    const e = env as Record<string, unknown>;
    e.SMTP_HOST = "smtp.example.com";
    e.SMTP_USER = "smtp-user";
    e.SMTP_PASS = "smtp-pass";
    e.RESEND_API_KEY = "re_test_key";
    smtpState.shouldThrow = true;

    const { sendEmail } = await import("./email-service");
    const result = await sendEmail({
      to: "test@example.com",
      subject: "fallback resend",
      html: "<p>hello</p>",
    });

    expect(result.success).toBe(true);
    expect(smtpState.sendCalls.length).toBe(1);
    expect(resendState.sendCalls.length).toBe(1);
  });

  it("returns failure when Resend responds with API error", async () => {
    (env as Record<string, unknown>).RESEND_API_KEY = "re_test_key";
    resendState.shouldReturnError = true;

    const { sendEmail } = await import("./email-service");
    const result = await sendEmail({
      to: "test@example.com",
      subject: "resend api error",
      html: "<p>hello</p>",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("resend api error");
    expect(resendState.sendCalls.length).toBe(1);
  });

  it("returns failure in production when no provider is configured", async () => {
    (env as Record<string, unknown>).NODE_ENV = "production";

    const { sendEmail } = await import("./email-service");
    const result = await sendEmail({
      to: "test@example.com",
      subject: "no provider production",
      html: "<p>hello</p>",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No email provider configured");
  });

  it("returns failure in production when SMTP fails and Resend is missing", async () => {
    const e = env as Record<string, unknown>;
    e.NODE_ENV = "production";
    e.SMTP_HOST = "smtp.example.com";
    e.SMTP_USER = "smtp-user";
    e.SMTP_PASS = "smtp-pass";
    smtpState.shouldThrow = true;

    const { sendEmail } = await import("./email-service");
    const result = await sendEmail({
      to: "test@example.com",
      subject: "smtp fail without resend",
      html: "<p>hello</p>",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP failed");
    expect(resendState.sendCalls.length).toBe(0);
  });

  it("keeps dev/test mock mode when no provider is configured", async () => {
    const { sendEmail } = await import("./email-service");
    const result = await sendEmail({
      to: "test@example.com",
      subject: "mock mode",
      html: "<p>hello</p>",
    });

    expect(result.success).toBe(true);
    expect(smtpState.sendCalls.length).toBe(0);
    expect(resendState.sendCalls.length).toBe(0);
  });
});
