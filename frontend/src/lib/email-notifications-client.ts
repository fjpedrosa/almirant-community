/**
 * Thin client for the backend's internal email endpoints.
 *
 * Extracted from the (now deleted) server auth module: the Better-Auth server
 * moved to the backend, but this helper is a plain `fetch()` to the backend's
 * internal email API and is still called from a frontend server action
 * (`domains/teams/.../send-member-removed-email.ts`).
 */

type MemberRemovedEmailRequest = {
  email: string;
  memberName: string;
  organizationName: string;
  removedAt: string;
};

const getMemberRemovedEmailEndpoint = (): string => {
  const backendUrl = process.env.BACKEND_URL?.trim();
  if (backendUrl) {
    return `${backendUrl.replace(/\/+$/, "")}/internal/emails/member-removed`;
  }

  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl && !publicApiUrl.startsWith("/")) {
    return `${publicApiUrl.replace(/\/+$/, "")}/internal/emails/member-removed`;
  }

  return "http://localhost:3001/internal/emails/member-removed";
};

export const sendMemberRemovedEmailViaBackend = async (
  payload: MemberRemovedEmailRequest,
): Promise<void> => {
  const secret = process.env.INTERNAL_EMAIL_API_SECRET?.trim();
  if (!secret) {
    throw new Error("INTERNAL_EMAIL_API_SECRET is not configured");
  }

  const response = await fetch(getMemberRemovedEmailEndpoint(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-email-secret": secret,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (response.ok) return;

  let message = `Member removal email request failed (${response.status})`;
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) {
      message = `Member removal email request failed (${response.status}): ${data.error}`;
    }
  } catch {
    const body = await response.text().catch(() => "");
    if (body) {
      message = `Member removal email request failed (${response.status}): ${body}`;
    }
  }

  throw new Error(message);
};
