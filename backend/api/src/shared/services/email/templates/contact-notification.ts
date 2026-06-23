interface ContactNotificationParams {
  email: string;
  reason: string;
  message: string;
  submissionId: string;
  ipAddress?: string | null;
  createdAt: string; // ISO 8601
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const REASON_LABELS: Record<string, string> = {
  general: "General Inquiry",
  support: "Support",
  partnership: "Partnership",
  feedback: "Feedback",
  other: "Other",
};

export const buildContactNotificationSubject = ({
  email,
  reason,
}: {
  email: string;
  reason: string;
}): string => {
  const label = REASON_LABELS[reason] ?? reason;
  return `New contact from ${email} — ${label}`;
};

export const buildContactNotificationHtml = ({
  email,
  reason,
  message,
  submissionId,
  ipAddress,
  createdAt,
}: ContactNotificationParams): string => {
  const reasonLabel = REASON_LABELS[reason] ?? reason;
  const formattedDate = new Date(createdAt).toUTCString();
  const messageHtml = escapeHtml(message).replace(/\n/g, "<br />");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Contact Submission</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:#f4f4f5;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#fff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:24px 32px;background:linear-gradient(135deg,#1e1b4b 0%,#312e81 100%);color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:20px;font-weight:700;color:#ffffff;">
                    New Contact Submission
                  </td>
                  <td style="vertical-align:middle;text-align:right;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;">
                      <tr>
                        <td style="vertical-align:middle;">
                          <img src="https://almirant.ai/logo-white.svg" alt="Almirant" width="20" height="20" style="display:block;width:20px;height:20px;" />
                        </td>
                        <td style="vertical-align:middle;padding-left:8px;font-size:14px;font-weight:600;color:rgba(255,255,255,0.8);">
                          Almirant
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td style="padding:8px 0;font-size:13px;color:#6b7280;width:100px;vertical-align:top;">From</td>
                  <td style="padding:8px 0;font-size:14px;color:#111827;font-weight:600;">${escapeHtml(email)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:13px;color:#6b7280;vertical-align:top;">Reason</td>
                  <td style="padding:8px 0;font-size:14px;color:#111827;">${escapeHtml(reasonLabel)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:13px;color:#6b7280;vertical-align:top;">Date</td>
                  <td style="padding:8px 0;font-size:14px;color:#111827;">${escapeHtml(formattedDate)}</td>
                </tr>
              </table>
              <div style="padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:20px;">
                <p style="margin:0 0 6px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#111827;">${messageHtml}</p>
              </div>
              <p style="margin:0;font-size:11px;color:#9ca3af;">
                Submission ID: ${escapeHtml(submissionId)}${ipAddress ? ` &middot; IP: ${escapeHtml(ipAddress)}` : ""}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
};
