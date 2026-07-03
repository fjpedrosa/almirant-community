import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { buildInvitationEmailHtml } from "../../../shared/services/email/templates/invitation";
import { getInvitationAppBaseUrl } from "./invitation-app-base-url";

// The org-plugin `sendInvitationEmail` delegates to `sendInvitationEmailInProcess`,
// which calls the SHARED `sendEmail` service. We mock that service and, per the
// mock.module hygiene rule, capture the REAL module first and restore it in
// afterAll so the registration never leaks into sibling test files.

const EMAIL_SERVICE_PATH = "../../../shared/services/email-service";

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  from?: string;
}
type SendEmailResult = { success: boolean; error?: string; emailId?: string };

let sendEmailResult: SendEmailResult = { success: true };
const sendEmailCalls: SendEmailArgs[] = [];
const sendEmailMock = mock(async (args: SendEmailArgs) => {
  sendEmailCalls.push(args);
  return sendEmailResult;
});

let sendInvitationEmailInProcess: (payload: {
  acceptUrl: string;
  email: string;
  organizationName: string;
  inviterName: string;
  inviterEmail: string;
  role: string;
}) => Promise<void>;

let realEmailService: typeof import("../../../shared/services/email-service");

beforeAll(async () => {
  realEmailService = await import(EMAIL_SERVICE_PATH);
  // Register the mock BEFORE importing auth.ts so its `sendEmail` binding
  // resolves to the mock (auth.ts imports sendEmail at module load).
  mock.module(EMAIL_SERVICE_PATH, () => ({
    ...realEmailService,
    sendEmail: sendEmailMock,
  }));
  ({ sendInvitationEmailInProcess } = await import("./auth.ts"));
});

afterAll(() => {
  // Restore the real module so mock.module does not leak process-globally.
  mock.module(EMAIL_SERVICE_PATH, () => realEmailService);
});

beforeEach(() => {
  sendEmailCalls.length = 0;
  sendEmailResult = { success: true };
  sendEmailMock.mockClear();
});

const basePayload = () => {
  const invitationId = "inv-abc-123";
  const acceptUrl = `${getInvitationAppBaseUrl({
    NEXT_PUBLIC_SITE_URL: "https://app.example.com",
  })}/accept-invitation/${invitationId}`;

  return {
    invitationId,
    acceptUrl,
    email: "invitee@example.com",
    organizationName: "Acme Workspace",
    inviterName: "Jane Admin",
    inviterEmail: "jane@example.com",
    role: "member",
  };
};

describe("sendInvitationEmailInProcess", () => {
  it("sends exactly one email with the workspace subject and rendered template html", async () => {
    const payload = basePayload();

    await sendInvitationEmailInProcess({
      acceptUrl: payload.acceptUrl,
      email: payload.email,
      organizationName: payload.organizationName,
      inviterName: payload.inviterName,
      inviterEmail: payload.inviterEmail,
      role: payload.role,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const [args] = sendEmailCalls;
    expect(args!.to).toBe(payload.email);
    // subject contains the workspace name
    expect(args!.subject).toBe(
      `You've been invited to ${payload.organizationName}`,
    );
    expect(args!.subject).toContain(payload.organizationName);

    // html is produced by buildInvitationEmailHtml with the workspace name
    const expectedHtml = buildInvitationEmailHtml({
      acceptUrl: payload.acceptUrl,
      workspaceName: payload.organizationName,
      inviterName: payload.inviterName,
      inviterEmail: payload.inviterEmail,
      role: payload.role,
    });
    expect(args!.html).toBe(expectedHtml);

    // acceptUrl = `${getInvitationAppBaseUrl(env)}/accept-invitation/${invitationId}`
    expect(payload.acceptUrl).toBe(
      "https://app.example.com/accept-invitation/inv-abc-123",
    );
    expect(args!.html).toContain(payload.acceptUrl);
  });

  it("throws with the service error when sendEmail reports failure", async () => {
    sendEmailResult = { success: false, error: "SMTP exploded" };
    const payload = basePayload();

    await expect(
      sendInvitationEmailInProcess({
        acceptUrl: payload.acceptUrl,
        email: payload.email,
        organizationName: payload.organizationName,
        inviterName: payload.inviterName,
        inviterEmail: payload.inviterEmail,
        role: payload.role,
      }),
    ).rejects.toThrow("SMTP exploded");
  });

  it("throws a default message when sendEmail fails without an error string", async () => {
    sendEmailResult = { success: false };
    const payload = basePayload();

    await expect(
      sendInvitationEmailInProcess({
        acceptUrl: payload.acceptUrl,
        email: payload.email,
        organizationName: payload.organizationName,
        inviterName: payload.inviterName,
        inviterEmail: payload.inviterEmail,
        role: payload.role,
      }),
    ).rejects.toThrow("Failed to send invitation email");
  });
});
