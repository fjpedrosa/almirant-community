import { t, type Locale } from '@almirant/i18n';

type WaitlistTier = 'pioneer' | 'supporter' | 'early_access';

interface ThankYouTemplateParams {
  name: string;
  email: string;
  waitlistEntryId?: string;
  locale?: Locale;
}

interface ThankYouEmailParams extends ThankYouTemplateParams {
  tier: WaitlistTier;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const buildTrackedUrl = (
  tierKey: 'pioneer' | 'supporter' | 'earlyAdopter',
  waitlistEntryId?: string,
): string => {
  const params = new URLSearchParams({
    utm_source: 'email',
    utm_medium: 'waitlist',
    utm_campaign: `thank-you-${tierKey}`,
  });
  if (waitlistEntryId) params.set('wid', waitlistEntryId);
  return `https://almirant.ai?${params.toString()}`;
};

const tierToTranslationKey = (tier: WaitlistTier): 'pioneer' | 'supporter' | 'earlyAdopter' => {
  switch (tier) {
    case 'pioneer':
      return 'pioneer';
    case 'supporter':
      return 'supporter';
    case 'early_access':
      return 'earlyAdopter';
  }
};

const buildHtmlShell = (
  locale: Locale,
  subject: string,
  bodyContent: string,
  siteUrl: string = 'https://almirant.ai',
): string => `
<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:#f4f4f5;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background:linear-gradient(135deg,#1e1b4b 0%,#312e81 100%);color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:20px;font-weight:700;color:#ffffff;">
                    ${t(locale, 'emails.waitlistThankYou.body.header')}
                  </td>
                  <td style="vertical-align:middle;text-align:right;">
                    <a href="${siteUrl}" target="_blank" style="text-decoration:none;">
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
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:4px 32px 24px;text-align:center;">
              <a href="${siteUrl}" target="_blank" style="display:inline-block;margin-bottom:12px;font-size:15px;font-weight:600;color:#4f46e5;text-decoration:none;">almirant.ai &rarr;</a>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">
                ${t(locale, 'emails.waitlistThankYou.body.footer')}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

const buildBodyContent = (
  locale: Locale,
  name: string,
  tierKey: 'pioneer' | 'supporter' | 'earlyAdopter',
): string => {
  const greeting = t(locale, 'emails.waitlistThankYou.body.greeting').replace('{name}', escapeHtml(name));
  const opening = t(locale, `emails.waitlistThankYou.body.${tierKey}.opening`);
  const main = t(locale, `emails.waitlistThankYou.body.${tierKey}.main`);
  const closing = t(locale, `emails.waitlistThankYou.body.${tierKey}.closing`);
  const replyInvite = t(locale, 'emails.waitlistThankYou.body.replyInvite');
  const signatureIntro = t(locale, 'emails.waitlistThankYou.body.signatureIntro');
  const signature = t(locale, 'emails.waitlistThankYou.body.signature');

  return `
              <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#111827;">${greeting}</p>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151;">${opening}</p>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151;">${main}</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">${closing}</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;background:#f9fafb;padding:16px;border-radius:8px;border-left:3px solid #111827;">${replyInvite}</p>
              <!-- Signature divider -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:0 0 16px;">
                    <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:#6b7280;font-style:italic;">${signatureIntro}</p>
              <p style="margin:0;font-size:14px;line-height:1.5;color:#111827;font-weight:600;">${signature} &#x1F99E;</p>`;
};

export const buildThankYouPioneerHtml = ({
  name,
  email: _email,
  waitlistEntryId,
  locale = 'en',
}: ThankYouTemplateParams): string => {
  const subject = t(locale, 'emails.waitlistThankYou.subject.pioneer');
  const bodyContent = buildBodyContent(locale, name, 'pioneer');
  return buildHtmlShell(locale, subject, bodyContent, buildTrackedUrl('pioneer', waitlistEntryId));
};

export const buildThankYouSupporterHtml = ({
  name,
  email: _email,
  waitlistEntryId,
  locale = 'en',
}: ThankYouTemplateParams): string => {
  const subject = t(locale, 'emails.waitlistThankYou.subject.supporter');
  const bodyContent = buildBodyContent(locale, name, 'supporter');
  return buildHtmlShell(locale, subject, bodyContent, buildTrackedUrl('supporter', waitlistEntryId));
};

export const buildThankYouEarlyAdopterHtml = ({
  name,
  email: _email,
  waitlistEntryId,
  locale = 'en',
}: ThankYouTemplateParams): string => {
  const subject = t(locale, 'emails.waitlistThankYou.subject.earlyAdopter');
  const bodyContent = buildBodyContent(locale, name, 'earlyAdopter');
  return buildHtmlShell(locale, subject, bodyContent, buildTrackedUrl('earlyAdopter', waitlistEntryId));
};

export const getThankYouSubject = (tier: WaitlistTier, locale: Locale = 'en'): string => {
  const key = tierToTranslationKey(tier);
  return t(locale, `emails.waitlistThankYou.subject.${key}`);
};

export const buildThankYouEmailHtml = ({
  name,
  email,
  tier,
  waitlistEntryId,
  locale = 'en',
}: ThankYouEmailParams): string => {
  const params: ThankYouTemplateParams = { name, email, waitlistEntryId, locale };

  switch (tier) {
    case 'pioneer':
      return buildThankYouPioneerHtml(params);
    case 'supporter':
      return buildThankYouSupporterHtml(params);
    case 'early_access':
      return buildThankYouEarlyAdopterHtml(params);
  }
};
