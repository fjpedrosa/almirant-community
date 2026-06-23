import { t, type Locale } from '@almirant/i18n';

interface WaitlistReferralConfirmedTemplateParams {
  referredName?: string | null;
  locale?: Locale;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const buildWaitlistReferralConfirmedHtml = ({
  referredName,
  locale = 'en',
}: WaitlistReferralConfirmedTemplateParams): string => {
  const nameText = referredName?.trim()
    ? `<strong>${escapeHtml(referredName.trim())}</strong>`
    : t(locale, 'emails.waitlist.body.referralFallbackName');

  return `
<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t(locale, 'emails.waitlist.subject.referralConfirmed')}</title>
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
                    ${t(locale, 'emails.waitlist.subject.referralConfirmed')}
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
              <p style="margin:0 0 14px;font-size:15px;color:#111827;">
                ${nameText} ${t(locale, 'emails.waitlist.body.referralMessage')}
              </p>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">
                ${t(locale, 'emails.waitlist.body.referralPointsAdded')}
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
