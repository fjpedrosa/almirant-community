import { t, type Locale } from '@almirant/i18n';
import { escapeHtml, renderEmailShell } from './render-email-shell';

interface EmailTemplate {
  subject: string;
  html: string;
}

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
    html: renderEmailShell({
      preheader: t(locale, 'emails.workItem.preheader.moved', { taskId: taskIdDisplay, from: args.fromColumnName, to: args.toColumnName }),
      heading: t(locale, 'emails.workItem.heading.moved'),
      headingIcon: "&#128260;",
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      footerText: t(locale, 'emails.common.manageNotifications'),
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
    html: renderEmailShell({
      preheader: t(locale, 'emails.workItem.preheader.assigned', { taskId: taskIdDisplay, title: args.title }),
      heading: t(locale, 'emails.workItem.heading.assigned'),
      headingIcon: "&#128100;",
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      footerText: t(locale, 'emails.common.manageNotifications'),
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
    html: renderEmailShell({
      preheader: t(locale, 'emails.workItem.preheader.completed', { taskId: taskIdDisplay }),
      heading: t(locale, 'emails.workItem.heading.completed'),
      headingIcon: "&#9989;",
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      footerText: t(locale, 'emails.common.manageNotifications'),
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
    html: renderEmailShell({
      preheader: t(locale, 'emails.workItem.preheader.reviewed', { result: resultKey, title: args.taskId ?? args.title }),
      heading: t(locale, 'emails.workItem.heading.reviewed'),
      headingIcon: icon,
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      footerText: t(locale, 'emails.common.manageNotifications'),
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
    html: renderEmailShell({
      preheader: t(locale, 'emails.workItem.preheader.userActions', { taskId: taskIdDisplay }),
      heading: t(locale, 'emails.workItem.heading.userActions'),
      headingIcon: "&#128204;",
      body,
      ctaUrl: args.url,
      ctaLabel: t(locale, 'emails.common.viewInApp'),
      footerText: t(locale, 'emails.common.manageNotifications'),
      locale,
    }),
  };
};

export const buildEmailMemberRemoved = (args: {
  memberName: string;
  workspaceName: string;
  removedAt: string;
  locale?: Locale;
}): EmailTemplate => {
  const locale = args.locale ?? 'en';

  const memberLabel = t(locale, 'emails.memberRemoval.meta.member');
  const workspaceLabel = t(locale, 'emails.memberRemoval.meta.workspace');
  const removedOnLabel = t(locale, 'emails.memberRemoval.meta.removedOn');

  const body =
    `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      ${escapeHtml(t(locale, 'emails.memberRemoval.body.accessRevoked', { workspace: args.workspaceName }))}
    </p>` +
    metaTable(
      metaRow(memberLabel, args.memberName) +
      metaRow(workspaceLabel, args.workspaceName) +
      metaRow(removedOnLabel, new Date(args.removedAt).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }))
    ) +
    `<p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
      ${escapeHtml(t(locale, 'emails.memberRemoval.body.disclaimer'))}
    </p>`;

  return {
    subject: t(locale, 'emails.memberRemoval.subject', { workspace: args.workspaceName }),
    html: renderEmailShell({
      preheader: t(locale, 'emails.memberRemoval.preheader', { workspace: args.workspaceName }),
      heading: t(locale, 'emails.memberRemoval.heading'),
      headingIcon: "&#128075;",
      body,
      ctaUrl: "https://almirant.ai",
      ctaLabel: t(locale, 'emails.memberRemoval.cta'),
      footerText: t(locale, 'emails.common.manageNotifications'),
      locale,
    }),
  };
};
