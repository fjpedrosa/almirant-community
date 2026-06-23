import { t, type Locale } from '@almirant/i18n';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

interface EmailTemplate {
  subject: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Shared layout wrapper
// ---------------------------------------------------------------------------

const wrapInLayout = (args: {
  preheader: string;
  heading: string;
  headingIcon: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
  locale: Locale;
}): string => {
  const footerText = t(args.locale, 'emails.common.manageNotifications');

  return `<!DOCTYPE html>
<html lang="${args.locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(args.preheader)}</title>
  <!--[if mso]>
  <style>body{font-family:Arial,sans-serif!important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <!-- Preheader text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(args.preheader)}</div>

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
                    ${args.headingIcon} ${escapeHtml(args.heading)}
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
            <td style="padding:28px 32px;">
              ${args.body}
              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
                <tr>
                  <td style="border-radius:8px;background:#4f46e5;">
                    <a href="${escapeHtml(args.ctaUrl)}" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.02em;">
                      ${escapeHtml(args.ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                ${escapeHtml(footerText)}
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

// ---------------------------------------------------------------------------
// Helper: metadata row
// ---------------------------------------------------------------------------

const metaRow = (label: string, value: string): string =>
  `<tr>
    <td style="padding:4px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:4px 0 4px 12px;font-size:13px;color:#111827;font-weight:500;">${escapeHtml(value)}</td>
  </tr>`;

const metaTable = (rows: string): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0;width:100%;">${rows}</table>`;

const taskBadge = (taskId: string | null, title: string): string => {
  const badge = taskId
    ? `<span style="display:inline-block;padding:2px 8px;background:#eef2ff;color:#4338ca;font-size:12px;font-weight:600;border-radius:4px;margin-right:8px;">${escapeHtml(taskId)}</span>`
    : "";
  return `<p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#111827;">${badge}${escapeHtml(title)}</p>`;
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const buildEmailWorkItemMoved = (args: {
  taskId: string | null;
  title: string;
  projectName: string | null;
  boardName: string | null;
  fromColumnName: string;
  toColumnName: string;
  url: string;
  locale?: Locale;
}): EmailTemplate => {
  const locale = args.locale ?? 'en';
  const taskIdDisplay = args.taskId ?? 'Work item';

  const fromLabel = t(locale, 'emails.workItem.body.movedFrom');
  const toLabel = t(locale, 'emails.workItem.body.movedTo');
  const projectLabel = t(locale, 'emails.workItem.meta.project');
  const boardLabel = t(locale, 'emails.workItem.meta.board');

  const rows =
    metaRow(fromLabel, args.fromColumnName) +
    metaRow(toLabel, args.toColumnName) +
    (args.projectName ? metaRow(projectLabel, args.projectName) : "") +
    (args.boardName ? metaRow(boardLabel, args.boardName) : "");

  const body = taskBadge(args.taskId, args.title) + metaTable(rows);

  return {
    subject: t(locale, 'emails.workItem.subject.moved', { title: args.taskId ?? args.title }),
    html: wrapInLayout({
      preheader: t(locale, 'emails.workItem.preheader.moved', { taskId: taskIdDisplay, from: args.fromColumnName, to: args.toColumnName }),
      heading: t(locale, 'emails.workItem.heading.moved'),
      headingIcon: "&#128260;",
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      locale,
    }),
  };
};

export const buildEmailWorkItemAssigned = (args: {
  taskId: string | null;
  title: string;
  projectName: string | null;
  boardName: string | null;
  assignee: string;
  url: string;
  locale?: Locale;
}): EmailTemplate => {
  const locale = args.locale ?? 'en';
  const taskIdDisplay = args.taskId ?? 'un work item';

  const assignedToLabel = t(locale, 'emails.workItem.body.assignedTo');
  const projectLabel = t(locale, 'emails.workItem.meta.project');
  const boardLabel = t(locale, 'emails.workItem.meta.board');

  const rows =
    metaRow(assignedToLabel, args.assignee) +
    (args.projectName ? metaRow(projectLabel, args.projectName) : "") +
    (args.boardName ? metaRow(boardLabel, args.boardName) : "");

  const body = taskBadge(args.taskId, args.title) + metaTable(rows);

  return {
    subject: t(locale, 'emails.workItem.subject.assigned', { title: args.taskId ?? args.title }),
    html: wrapInLayout({
      preheader: t(locale, 'emails.workItem.preheader.assigned', { taskId: taskIdDisplay, title: args.title }),
      heading: t(locale, 'emails.workItem.heading.assigned'),
      headingIcon: "&#128100;",
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      locale,
    }),
  };
};

export const buildEmailWorkItemDone = (args: {
  taskId: string | null;
  title: string;
  projectName: string | null;
  boardName: string | null;
  url: string;
  locale?: Locale;
}): EmailTemplate => {
  const locale = args.locale ?? 'en';
  const taskIdDisplay = args.taskId ?? 'Work item';

  const projectLabel = t(locale, 'emails.workItem.meta.project');
  const boardLabel = t(locale, 'emails.workItem.meta.board');

  const rows =
    (args.projectName ? metaRow(projectLabel, args.projectName) : "") +
    (args.boardName ? metaRow(boardLabel, args.boardName) : "");

  const body = taskBadge(args.taskId, args.title) + (rows ? metaTable(rows) : "");

  return {
    subject: t(locale, 'emails.workItem.subject.completed', { title: args.taskId ?? args.title }),
    html: wrapInLayout({
      preheader: t(locale, 'emails.workItem.preheader.completed', { taskId: taskIdDisplay }),
      heading: t(locale, 'emails.workItem.heading.completed'),
      headingIcon: "&#9989;",
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      locale,
    }),
  };
};

export const buildEmailReviewCompleted = (args: {
  taskId: string | null;
  title: string;
  result: "pass" | "fail";
  summary: string;
  url: string;
  locale?: Locale;
}): EmailTemplate => {
  const locale = args.locale ?? 'en';

  const resultLabel = args.result === "pass"
    ? t(locale, 'emails.workItem.body.reviewPassed')
    : t(locale, 'emails.workItem.body.reviewFailed');
  const resultColor = args.result === "pass" ? "#16a34a" : "#dc2626";
  const icon = args.result === "pass" ? "&#9989;" : "&#10060;";
  const trimmedSummary = args.summary.trim().slice(0, 600);
  const resultTextLabel = t(locale, 'emails.workItem.body.reviewResult');

  const body =
    taskBadge(args.taskId, args.title) +
    `<p style="margin:12px 0 4px;font-size:14px;">
      ${resultTextLabel}: <strong style="color:${resultColor};">${resultLabel}</strong>
    </p>` +
    (trimmedSummary
      ? `<div style="margin:12px 0 0;padding:12px 16px;background:#f9fafb;border-left:3px solid ${resultColor};border-radius:4px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#374151;">${escapeHtml(trimmedSummary)}</p>
        </div>`
      : "");

  const resultKey = resultLabel.toLowerCase();

  return {
    subject: t(locale, 'emails.workItem.subject.reviewed', { result: resultKey, title: args.taskId ?? args.title }),
    html: wrapInLayout({
      preheader: t(locale, 'emails.workItem.preheader.reviewed', { result: resultKey, title: args.taskId ?? args.title }),
      heading: t(locale, 'emails.workItem.heading.reviewed'),
      headingIcon: icon,
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      locale,
    }),
  };
};

export const buildEmailSprintClosed = (args: {
  sprintName: string;
  completedCount: number;
  totalCount: number;
  boardName: string | null;
  url: string;
  locale?: Locale;
}): EmailTemplate => {
  const locale = args.locale ?? 'en';
  const pct = args.totalCount > 0 ? Math.round((args.completedCount / args.totalCount) * 100) : 0;

  const sprintLabel = t(locale, 'emails.sprint.meta.sprint');
  const completedLabel = t(locale, 'emails.sprint.meta.completed');
  const boardLabel = t(locale, 'emails.workItem.meta.board');

  const rows =
    metaRow(sprintLabel, args.sprintName) +
    metaRow(completedLabel, `${args.completedCount} / ${args.totalCount} (${pct}%)`) +
    (args.boardName ? metaRow(boardLabel, args.boardName) : "");

  const body =
    `<p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#111827;">${escapeHtml(t(locale, 'emails.sprint.heading.closed'))}</p>` +
    metaTable(rows);

  return {
    subject: t(locale, 'emails.sprint.subject.closed', { name: args.sprintName }),
    html: wrapInLayout({
      preheader: t(locale, 'emails.sprint.preheader.closed', { name: args.sprintName, completed: args.completedCount, total: args.totalCount }),
      heading: t(locale, 'emails.sprint.heading.closed'),
      headingIcon: "&#128202;",
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewReport'),
      locale,
    }),
  };
};

export const buildEmailUserActions = (args: {
  taskId: string | null;
  title: string;
  userActions: string;
  url: string;
  locale?: Locale;
}): EmailTemplate => {
  const locale = args.locale ?? 'en';
  const taskIdDisplay = args.taskId ?? 'Work item';

  const firstLine = args.userActions
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  const snippet = (firstLine ?? args.userActions).slice(0, 400);

  const body =
    taskBadge(args.taskId, args.title) +
    (snippet
      ? `<div style="margin:12px 0 0;padding:12px 16px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#374151;">${escapeHtml(snippet)}</p>
        </div>`
      : "");

  return {
    subject: t(locale, 'emails.workItem.subject.userActions', { title: args.taskId ?? args.title }),
    html: wrapInLayout({
      preheader: t(locale, 'emails.workItem.preheader.userActions', { taskId: taskIdDisplay }),
      heading: t(locale, 'emails.workItem.heading.userActions'),
      headingIcon: "&#128204;",
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      locale,
    }),
  };
};

export const buildEmailMemberRemoved = (args: {
  memberName: string;
  organizationName: string;
  removedAt: string;
  locale?: Locale;
}): EmailTemplate => {
  const locale = args.locale ?? 'en';

  const memberLabel = t(locale, 'emails.memberRemoval.meta.member');
  const organizationLabel = t(locale, 'emails.memberRemoval.meta.organization');
  const removedOnLabel = t(locale, 'emails.memberRemoval.meta.removedOn');

  const body =
    `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      ${escapeHtml(t(locale, 'emails.memberRemoval.body.accessRevoked', { organization: args.organizationName }))}
    </p>` +
    metaTable(
      metaRow(memberLabel, args.memberName) +
      metaRow(organizationLabel, args.organizationName) +
      metaRow(removedOnLabel, new Date(args.removedAt).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }))
    ) +
    `<p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
      ${escapeHtml(t(locale, 'emails.memberRemoval.body.disclaimer'))}
    </p>`;

  return {
    subject: t(locale, 'emails.memberRemoval.subject', { organization: args.organizationName }),
    html: wrapInLayout({
      preheader: t(locale, 'emails.memberRemoval.preheader', { organization: args.organizationName }),
      heading: t(locale, 'emails.memberRemoval.heading'),
      headingIcon: "&#128075;",
      body,
      ctaUrl: "https://almirant.ai",
      ctaLabel: t(locale, 'emails.memberRemoval.cta'),
      locale,
    }),
  };
};
