interface InvitationEmailParams {
  acceptUrl: string;
  organizationName: string;
  inviterName: string;
  inviterEmail: string;
  role: string;
}

export const buildInvitationEmailHtml = ({
  acceptUrl,
  organizationName,
  inviterName,
  inviterEmail,
  role,
}: InvitationEmailParams): string => {
  const roleBadgeColor =
    role === "owner" ? "#7c3aed" : role === "admin" ? "#2563eb" : "#059669";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited to ${escapeHtml(organizationName)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding:24px 32px;background:linear-gradient(135deg,#1e1b4b 0%,#312e81 100%);color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:20px;font-weight:700;color:#ffffff;">
                    You've been invited!
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
            <td style="padding:40px;">
              <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;line-height:1.3;">
                You've been invited!
              </h2>
              <p style="margin:0 0 24px;font-size:15px;color:#71717a;line-height:1.6;">
                <strong style="color:#18181b;">${escapeHtml(inviterName)}</strong>
                (${escapeHtml(inviterEmail)}) has invited you to join
                <strong style="color:#18181b;">${escapeHtml(organizationName)}</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:4px 12px;background-color:${roleBadgeColor}14;border-radius:9999px;font-size:13px;font-weight:600;color:${roleBadgeColor};text-transform:capitalize;">
                    ${escapeHtml(role)}
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a
                      href="${escapeHtml(acceptUrl)}"
                      target="_blank"
                      style="display:inline-block;padding:12px 32px;background-color:#18181b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;line-height:1.4;"
                    >
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;color:#a1a1aa;line-height:1.6;text-align:center;">
                If you weren't expecting this invitation, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #f4f4f5;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5;">
                Almirant &middot; The Operating System for human-agent teams
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

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
