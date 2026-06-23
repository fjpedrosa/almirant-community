import { t, type Locale } from '@almirant/i18n';

interface WaitlistConfirmationTemplateParams {
  confirmUrl: string;
  email: string;
  name?: string | null;
  locale?: Locale;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const buildWaitlistConfirmationHtml = ({
  confirmUrl,
  email,
  name,
  locale = 'en',
}: WaitlistConfirmationTemplateParams): string => {
  const displayName = name?.trim() || email;
  const greetingName = ` ${escapeHtml(displayName)}`;
  const greeting = t(locale, 'emails.waitlist.body.greeting');
  const greetingSuffix = t(locale, 'emails.waitlist.body.greetingSuffix');
  const preheaderText = t(locale, 'emails.waitlist.body.confirmMessage');

  return `
<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t(locale, 'emails.waitlist.subject.confirmation')}</title>
  <!--[if mso]>
  <style>body{font-family:Arial,sans-serif!important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <!-- Preheader text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheaderText)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:#f4f4f5;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background:linear-gradient(135deg,#1e1b4b 0%,#312e81 100%);color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:20px;font-weight:700;color:#ffffff;">
                    ${escapeHtml(t(locale, 'emails.waitlist.body.subheading'))}
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
          <!-- Body -->
          <tr>
            <td style="padding:28px 32px 28px;">
              <p style="margin:0 0 6px;font-size:16px;line-height:1.5;color:#111827;font-weight:600;">${greeting}${greetingName}${greetingSuffix}</p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#6b7280;">${t(locale, 'emails.waitlist.body.warmGreeting')}</p>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4b5563;">
                ${t(locale, 'emails.waitlist.body.confirmMessage')}
              </p>
              <!-- CTA Button (table-based for Outlook) -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-radius:8px;background:#4f46e5;">
                    <a href="${escapeHtml(confirmUrl)}" target="_blank" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.02em;">
                      ${t(locale, 'emails.waitlist.body.confirmButton')}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">
                ${t(locale, 'emails.waitlist.body.disclaimer')}
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                ${t(locale, 'emails.waitlist.body.footer')}
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
