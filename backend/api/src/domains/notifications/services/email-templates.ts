import { env } from "@almirant/config";
import { t, type Locale } from "@almirant/i18n";
import { tiptapHtmlToEmailHtml } from "./tiptap-html-to-email";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssignmentItem {
  ideaItemId: string;
  ideaItemTitle: string;
  assignerName: string;
  itemLink?: string;
}

export interface AssignmentEmailResult {
  subject: string;
  html: string;
}

export interface CommentItem {
  ideaItemId: string;
  ideaItemTitle: string;
  commentContent: string;
  commenterName: string;
  itemLink?: string;
}

export interface CommentEmailResult {
  subject: string;
  html: string;
}

export interface MentionItem {
  ideaItemId: string;
  ideaItemTitle: string;
  commentContent: string;
  mentionerName: string;
  itemLink?: string;
}

export interface MentionEmailResult {
  subject: string;
  html: string;
}

export interface StatusChangedItem {
  title: string;
  body?: string | null;
  itemLink?: string;
}

export interface StatusChangedEmailResult {
  subject: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const getAppBaseUrl = (): string => {
  const firstOrigin = env.CORS_ORIGIN.split(",")[0];
  return (firstOrigin ?? env.CORS_ORIGIN).trim();
};

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const truncate = (text: string, maxLength: number = 200): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
};

const resolveItemUrl = (baseUrl: string, itemLink: string | undefined, fallbackPath: string): string => {
  if (!itemLink || itemLink.trim().length === 0) {
    return `${baseUrl}${fallbackPath}`;
  }
  if (/^https?:\/\//i.test(itemLink)) {
    return itemLink;
  }
  const normalizedPath = itemLink.startsWith("/") ? itemLink : `/${itemLink}`;
  return `${baseUrl}${normalizedPath}`;
};

// ---------------------------------------------------------------------------
// Shared layout pieces (inline CSS, table-based)
// ---------------------------------------------------------------------------

const BRAND_COLOR = "#4f46e5";
const BG_COLOR = "#f4f4f5";
const CARD_BG = "#ffffff";
const TEXT_COLOR = "#1e293b";
const SECONDARY_TEXT = "#64748b";
const LINK_COLOR = "#4f46e5";
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const htmlOpen = (title: string, locale: Locale): string => `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BG_COLOR};font-family:${FONT_STACK};">`;

const htmlClose = `</body>
</html>`;

const wrapperOpen = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:${BG_COLOR};">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${CARD_BG};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">`;

const wrapperClose = `        </table>
      </td>
    </tr>
  </table>`;

const header = (heading: string): string => `<tr>
            <td style="padding:24px 32px;background:linear-gradient(135deg,#1e1b4b 0%,#312e81 100%);color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:20px;font-weight:700;color:#ffffff;">
                    ${escapeHtml(heading)}
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
          </tr>`;

const footer = (locale: Locale): string => `<tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:${SECONDARY_TEXT};text-align:center;">
                ${t(locale, 'emails.ideaHub.body.footer')}
              </p>
            </td>
          </tr>`;

const greeting = (name: string, locale: Locale): string =>
  `<p style="margin:0 0 16px;font-size:16px;color:${TEXT_COLOR};font-weight:600;">${t(locale, 'emails.ideaHub.body.greeting', { name: escapeHtml(name) })}</p>`;

// ---------------------------------------------------------------------------
// Assignment email
// ---------------------------------------------------------------------------

export const buildAssignmentEmail = (
  recipientName: string,
  assignments: AssignmentItem[],
  locale: Locale = 'en',
): AssignmentEmailResult => {
  const count = assignments.length;
  const baseUrl = getAppBaseUrl();

  const subject =
    count === 1
      ? t(locale, 'emails.ideaHub.subject.assignmentSingle', {
          assignerName: assignments[0]!.assignerName,
        })
      : t(locale, 'emails.ideaHub.subject.assignmentPlural', { count: String(count) });

  const introText =
    count === 1
      ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${SECONDARY_TEXT};">${t(locale, 'emails.ideaHub.body.assignmentSingle')}</p>`
      : `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${SECONDARY_TEXT};">${t(locale, 'emails.ideaHub.body.assignmentPlural', { count: String(count) })}</p>`;

  const assignedByLabel = t(locale, 'emails.ideaHub.body.assignedBy');

  const itemRows = assignments
    .map((item) => {
      const url = resolveItemUrl(
        baseUrl,
        item.itemLink,
        `/ideas?id=${encodeURIComponent(item.ideaItemId)}`,
      );
      return `<tr>
              <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                <a href="${escapeHtml(url)}" target="_blank" style="color:${LINK_COLOR};text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(item.ideaItemTitle)}</a>
                <p style="margin:4px 0 0;font-size:13px;color:${SECONDARY_TEXT};">${assignedByLabel} ${escapeHtml(item.assignerName)}</p>
              </td>
            </tr>`;
    })
    .join("\n");

  const html = `${htmlOpen(subject, locale)}
  ${wrapperOpen}
          ${header(subject)}
          <tr>
            <td style="padding:28px 32px;">
              ${greeting(recipientName, locale)}
              ${introText}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;overflow:hidden;">
            ${itemRows}
              </table>
            </td>
          </tr>
          ${footer(locale)}
  ${wrapperClose}
${htmlClose}`;

  return { subject, html };
};

// ---------------------------------------------------------------------------
// Comment email
// ---------------------------------------------------------------------------

export const buildCommentEmail = (
  recipientName: string,
  comments: CommentItem[],
  locale: Locale = 'en',
): CommentEmailResult => {
  const count = comments.length;
  const baseUrl = getAppBaseUrl();

  const subject =
    count === 1
      ? t(locale, 'emails.ideaHub.subject.commentSingle', {
          commenterName: comments[0]!.commenterName,
          ideaTitle: comments[0]!.ideaItemTitle,
        })
      : t(locale, 'emails.ideaHub.subject.commentPlural', { count: String(count) });

  const introText =
    count === 1
      ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${SECONDARY_TEXT};">${t(locale, 'emails.ideaHub.body.commentSingle')}</p>`
      : `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${SECONDARY_TEXT};">${t(locale, 'emails.ideaHub.body.commentPlural', { count: String(count) })}</p>`;

  const commentedOnLabel = t(locale, 'emails.ideaHub.body.commentedOn');

  const itemRows = comments
    .map((item) => {
      const url = resolveItemUrl(
        baseUrl,
        item.itemLink,
        `/ideas?id=${encodeURIComponent(item.ideaItemId)}`,
      );
      const emailContent = tiptapHtmlToEmailHtml(item.commentContent, 200);
      return `<tr>
              <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                <p style="margin:0 0 4px;font-size:13px;color:${SECONDARY_TEXT};">
                  <strong style="color:${TEXT_COLOR};">${escapeHtml(item.commenterName)}</strong> ${commentedOnLabel}
                  <a href="${escapeHtml(url)}" target="_blank" style="color:${LINK_COLOR};text-decoration:none;font-weight:600;">${escapeHtml(item.ideaItemTitle)}</a>:
                </p>
                <div style="margin:6px 0 0;font-size:14px;line-height:1.5;color:${TEXT_COLOR};background:#ffffff;padding:8px 12px;border-radius:6px;border-left:3px solid ${BRAND_COLOR};">
                  ${emailContent}
                </div>
              </td>
            </tr>`;
    })
    .join("\n");

  const html = `${htmlOpen(subject, locale)}
  ${wrapperOpen}
          ${header(subject)}
          <tr>
            <td style="padding:28px 32px;">
              ${greeting(recipientName, locale)}
              ${introText}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;overflow:hidden;">
            ${itemRows}
              </table>
            </td>
          </tr>
          ${footer(locale)}
  ${wrapperClose}
${htmlClose}`;

  return { subject, html };
};

// ---------------------------------------------------------------------------
// Mention email
// ---------------------------------------------------------------------------

export const buildMentionEmail = (
  recipientName: string,
  mentions: MentionItem[],
  locale: Locale = 'en',
): MentionEmailResult => {
  const count = mentions.length;
  const baseUrl = getAppBaseUrl();

  const subject =
    count === 1
      ? t(locale, 'emails.ideaHub.subject.mentionSingle', {
          mentionerName: mentions[0]!.mentionerName,
          ideaTitle: mentions[0]!.ideaItemTitle,
        })
      : t(locale, 'emails.ideaHub.subject.mentionPlural', { count: String(count) });

  const introText =
    count === 1
      ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${SECONDARY_TEXT};">${t(locale, 'emails.ideaHub.body.mentionSingle')}</p>`
      : `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${SECONDARY_TEXT};">${t(locale, 'emails.ideaHub.body.mentionPlural', { count: String(count) })}</p>`;

  const mentionedOnLabel = t(locale, 'emails.ideaHub.body.mentionedOn');

  const itemRows = mentions
    .map((item) => {
      const url = resolveItemUrl(
        baseUrl,
        item.itemLink,
        `/ideas?id=${encodeURIComponent(item.ideaItemId)}`,
      );
      const emailContent = tiptapHtmlToEmailHtml(item.commentContent, 200);
      return `<tr>
              <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                <p style="margin:0 0 4px;font-size:13px;color:${SECONDARY_TEXT};">
                  <strong style="color:${TEXT_COLOR};">${escapeHtml(item.mentionerName)}</strong> ${mentionedOnLabel}
                  <a href="${escapeHtml(url)}" target="_blank" style="color:${LINK_COLOR};text-decoration:none;font-weight:600;">${escapeHtml(item.ideaItemTitle)}</a>:
                </p>
                <div style="margin:6px 0 0;font-size:14px;line-height:1.5;color:${TEXT_COLOR};background:#ffffff;padding:8px 12px;border-radius:6px;border-left:3px solid ${BRAND_COLOR};">
                  ${emailContent}
                </div>
              </td>
            </tr>`;
    })
    .join("\n");

  const html = `${htmlOpen(subject, locale)}
  ${wrapperOpen}
          ${header(subject)}
          <tr>
            <td style="padding:28px 32px;">
              ${greeting(recipientName, locale)}
              ${introText}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;overflow:hidden;">
            ${itemRows}
              </table>
            </td>
          </tr>
          ${footer(locale)}
  ${wrapperClose}
${htmlClose}`;

  return { subject, html };
};

// ---------------------------------------------------------------------------
// Status changed email
// ---------------------------------------------------------------------------

export const buildStatusChangedEmail = (
  recipientName: string,
  updates: StatusChangedItem[],
  locale: Locale = "en",
): StatusChangedEmailResult => {
  const count = updates.length;
  const baseUrl = getAppBaseUrl();
  const isSpanish = locale.startsWith("es");
  const subject =
    count === 1
      ? updates[0]!.title
      : isSpanish
        ? `Tienes ${count} actualizaciones de estado`
        : `You have ${count} status updates`;
  const introText =
    count === 1
      ? isSpanish
        ? "Hay una nueva actualización de estado para revisar."
        : "There is a new status update to review."
      : isSpanish
        ? `Hay ${count} actualizaciones de estado para revisar.`
        : `There are ${count} status updates to review.`;
  const actionLabel = isSpanish ? "Abrir en Almirant" : "Open in Almirant";

  const itemRows = updates
    .map((item) => {
      const url = resolveItemUrl(baseUrl, item.itemLink, "/settings/quota");
      return `<tr>
              <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:${TEXT_COLOR};">${escapeHtml(item.title)}</p>
                ${item.body ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:${SECONDARY_TEXT};">${escapeHtml(truncate(item.body, 240))}</p>` : ""}
                <a href="${escapeHtml(url)}" target="_blank" style="color:${LINK_COLOR};text-decoration:none;font-size:13px;font-weight:600;">${actionLabel}</a>
              </td>
            </tr>`;
    })
    .join("\n");

  const html = `${htmlOpen(subject, locale)}
  ${wrapperOpen}
          ${header(subject)}
          <tr>
            <td style="padding:28px 32px;">
              ${greeting(recipientName, locale)}
              <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${SECONDARY_TEXT};">${introText}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;overflow:hidden;">
            ${itemRows}
              </table>
            </td>
          </tr>
          ${footer(locale)}
  ${wrapperClose}
${htmlClose}`;

  return { subject, html };
};
