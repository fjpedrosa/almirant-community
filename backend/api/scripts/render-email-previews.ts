/**
 * Render all email templates to a single HTML preview file.
 * Usage: cd backend && bun run api/scripts/render-email-previews.ts
 * Then open the generated file in a browser.
 */

// Set minimal env vars required by @almirant/config before any imports
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/preview';
process.env.CORS_ORIGIN ??= 'https://almirant.ai';
process.env.PORT ??= '3001';
process.env.NODE_ENV ??= 'development';

import { buildWaitlistConfirmationHtml } from '../src/lib/email/templates/waitlist-confirmation';
import { buildThankYouEmailHtml, getThankYouSubject } from '../src/lib/email/templates/waitlist-thank-you';
import { buildWaitlistReferralConfirmedHtml } from '../src/lib/email/templates/waitlist-referral-confirmed';
import { buildContactNotificationHtml, buildContactNotificationSubject } from '../src/lib/email/templates/contact-notification';
import { buildInvitationEmailHtml } from '../src/lib/email/templates/invitation';
import {
  buildEmailWorkItemMoved,
  buildEmailWorkItemAssigned,
  buildEmailWorkItemDone,
  buildEmailReviewCompleted,
  buildEmailSprintClosed,
  buildEmailUserActions,
  buildEmailMemberRemoved,
} from '../src/lib/email/templates';
import {
  buildAssignmentEmail,
  buildCommentEmail,
  buildMentionEmail,
  buildStatusChangedEmail,
} from '../src/lib/email-templates';

// ---- Generate all email previews ----

const emails: { title: string; subject: string; html: string }[] = [];

// 1. Waitlist Confirmation (no name - real scenario, users only provide email)
emails.push({
  title: 'Waitlist Confirmation (EN)',
  subject: 'Confirm your email for Almirant waitlist',
  html: buildWaitlistConfirmationHtml({
    confirmUrl: 'https://almirant.ai/waitlist/confirm?token=abc123',
    email: 'sam@example.com',
    name: null,
    locale: 'en',
  }),
});

emails.push({
  title: 'Waitlist Confirmation (ES)',
  subject: 'Confirma tu email para la waitlist de Almirant',
  html: buildWaitlistConfirmationHtml({
    confirmUrl: 'https://almirant.ai/waitlist/confirm?token=abc123',
    email: 'sam@example.com',
    name: null,
    locale: 'es',
  }),
});

// 2. Thank You - Pioneer
emails.push({
  title: 'Thank You — Pioneer (EN)',
  subject: getThankYouSubject('pioneer', 'en'),
  html: buildThankYouEmailHtml({ name: 'Sam', email: 'sam@example.com', tier: 'pioneer', waitlistEntryId: 'wl_preview_001', locale: 'en' }),
});

emails.push({
  title: 'Thank You — Pioneer (ES)',
  subject: getThankYouSubject('pioneer', 'es'),
  html: buildThankYouEmailHtml({ name: 'Sam', email: 'sam@example.com', tier: 'pioneer', waitlistEntryId: 'wl_preview_001', locale: 'es' }),
});

// 3. Thank You - Supporter
emails.push({
  title: 'Thank You — Supporter (EN)',
  subject: getThankYouSubject('supporter', 'en'),
  html: buildThankYouEmailHtml({ name: 'Laura', email: 'laura@example.com', tier: 'supporter', waitlistEntryId: 'wl_preview_002', locale: 'en' }),
});

emails.push({
  title: 'Thank You — Supporter (ES)',
  subject: getThankYouSubject('supporter', 'es'),
  html: buildThankYouEmailHtml({ name: 'Laura', email: 'laura@example.com', tier: 'supporter', waitlistEntryId: 'wl_preview_002', locale: 'es' }),
});

// 4. Thank You - Early Adopter
emails.push({
  title: 'Thank You — Early Adopter (EN)',
  subject: getThankYouSubject('early_access', 'en'),
  html: buildThankYouEmailHtml({ name: 'Alex', email: 'alex@example.com', tier: 'early_access', waitlistEntryId: 'wl_preview_003', locale: 'en' }),
});

emails.push({
  title: 'Thank You — Early Adopter (ES)',
  subject: getThankYouSubject('early_access', 'es'),
  html: buildThankYouEmailHtml({ name: 'Alex', email: 'alex@example.com', tier: 'early_access', waitlistEntryId: 'wl_preview_003', locale: 'es' }),
});

// 5. Referral Confirmed
emails.push({
  title: 'Referral Confirmed (EN)',
  subject: 'Your referral confirmed their email',
  html: buildWaitlistReferralConfirmedHtml({ referredName: 'Maria Lopez', locale: 'en' }),
});

emails.push({
  title: 'Referral Confirmed (ES)',
  subject: 'Tu referido confirmó su email',
  html: buildWaitlistReferralConfirmedHtml({ referredName: 'Maria Lopez', locale: 'es' }),
});

// 6. Contact Notification
emails.push({
  title: 'Contact Notification',
  subject: buildContactNotificationSubject({ email: 'prospect@company.com', reason: 'partnership' }),
  html: buildContactNotificationHtml({
    email: 'prospect@company.com',
    reason: 'partnership',
    message: 'Hi! We are interested in exploring a partnership with Almirant for our development teams.\n\nCould we set up a call this week?',
    submissionId: 'cs_abc123',
    ipAddress: '192.168.1.1',
    createdAt: new Date().toISOString(),
  }),
});

// 7. Invitation
emails.push({
  title: 'Workspace Invitation',
  subject: "You've been invited to Acme Corp",
  html: buildInvitationEmailHtml({
    acceptUrl: 'https://almirant.ai/accept-invite?token=xyz',
    workspaceName: 'Acme Corp',
    inviterName: 'Sam Rivera',
    inviterEmail: 'sam@acme.com',
    role: 'admin',
  }),
});

// 8. Work Item Moved
const wiMoved = buildEmailWorkItemMoved({
  taskId: 'A-1234',
  title: 'Implement user onboarding flow',
  projectName: 'Almirant',
  boardName: 'Sprint 12',
  fromColumnName: 'In Progress',
  toColumnName: 'To Review',
  url: 'https://almirant.ai/boards/sprint-12/A-1234',
  locale: 'en',
});
emails.push({ title: 'Work Item Moved (EN)', ...wiMoved });

// 9. Work Item Assigned
const wiAssigned = buildEmailWorkItemAssigned({
  taskId: 'A-1235',
  title: 'Fix login redirect bug',
  projectName: 'Almirant',
  boardName: 'Sprint 12',
  assignee: 'Alex Rivera',
  url: 'https://almirant.ai/boards/sprint-12/A-1235',
  locale: 'en',
});
emails.push({ title: 'Work Item Assigned (EN)', ...wiAssigned });

// 10. Work Item Done
const wiDone = buildEmailWorkItemDone({
  taskId: 'A-1236',
  title: 'Add dark mode support',
  projectName: 'Almirant',
  boardName: 'Sprint 12',
  url: 'https://almirant.ai/boards/sprint-12/A-1236',
  locale: 'en',
});
emails.push({ title: 'Work Item Completed (EN)', ...wiDone });

// 11. Review Completed (pass)
const reviewPass = buildEmailReviewCompleted({
  taskId: 'A-1237',
  title: 'Refactor auth middleware',
  result: 'pass',
  summary: 'All tests passing. Code follows repository pattern correctly. No security issues found. The session validation logic is clean and well-structured.',
  url: 'https://almirant.ai/boards/sprint-12/A-1237',
  locale: 'en',
});
emails.push({ title: 'Review Passed (EN)', ...reviewPass });

// 12. Review Completed (fail)
const reviewFail = buildEmailReviewCompleted({
  taskId: 'A-1238',
  title: 'Add CSV export endpoint',
  result: 'fail',
  summary: 'Missing input validation on the date range parameter. The endpoint does not handle pagination correctly for large datasets. SQL injection risk in the raw query on line 45.',
  url: 'https://almirant.ai/boards/sprint-12/A-1238',
  locale: 'en',
});
emails.push({ title: 'Review Failed (EN)', ...reviewFail });

// 13. Sprint Closed
const sprintClosed = buildEmailSprintClosed({
  sprintName: 'Sprint 12',
  completedCount: 18,
  totalCount: 22,
  boardName: 'Development',
  url: 'https://almirant.ai/sprints/sprint-12',
  locale: 'en',
});
emails.push({ title: 'Sprint Closed (EN)', ...sprintClosed });

// 14. User Actions Required
const userActions = buildEmailUserActions({
  taskId: 'A-1239',
  title: 'Deploy staging environment',
  userActions: 'Please verify the staging deployment is working correctly and run the smoke tests before promoting to production.',
  url: 'https://almirant.ai/boards/sprint-12/A-1239',
  locale: 'en',
});
emails.push({ title: 'User Actions Required (EN)', ...userActions });

// 15. Member Removed
const memberRemoved = buildEmailMemberRemoved({
  memberName: 'Carlos Garcia',
  workspaceName: 'Acme Corp',
  removedAt: new Date().toISOString(),
  locale: 'en',
});
emails.push({ title: 'Member Removed (EN)', ...memberRemoved });

const memberRemovedEs = buildEmailMemberRemoved({
  memberName: 'Carlos Garcia',
  workspaceName: 'Acme Corp',
  removedAt: new Date().toISOString(),
  locale: 'es',
});
emails.push({ title: 'Member Removed (ES)', ...memberRemovedEs });

// 16. Idea Hub — Assignment (single)
const assignSingle = buildAssignmentEmail('Sam', [
  { ideaItemId: 'idea-1', ideaItemTitle: 'Add AI-powered code suggestions', assignerName: 'Alex Rivera', itemLink: '/ideas?id=idea-1' },
], 'en');
emails.push({ title: 'Idea Assignment — Single (EN)', ...assignSingle });

// 17. Idea Hub — Assignment (multiple)
const assignMulti = buildAssignmentEmail('Sam', [
  { ideaItemId: 'idea-1', ideaItemTitle: 'Add AI-powered code suggestions', assignerName: 'Alex Rivera', itemLink: '/ideas?id=idea-1' },
  { ideaItemId: 'idea-2', ideaItemTitle: 'Redesign settings page', assignerName: 'Max Torres', itemLink: '/ideas?id=idea-2' },
  { ideaItemId: 'idea-3', ideaItemTitle: 'Mobile app push notifications', assignerName: 'Alex Rivera', itemLink: '/ideas?id=idea-3' },
], 'en');
emails.push({ title: 'Idea Assignment — Multiple (EN)', ...assignMulti });

// 18. Idea Hub — Comment (single)
const commentSingle = buildCommentEmail('Sam', [
  { ideaItemId: 'idea-1', ideaItemTitle: 'Add AI-powered code suggestions', commentContent: '<p>I think we should start with autocomplete before tackling full suggestions. What do you think?</p>', commenterName: 'Laura Perez', itemLink: '/ideas?id=idea-1' },
], 'en');
emails.push({ title: 'Idea Comment — Single (EN)', ...commentSingle });

// 19. Idea Hub — Comment (multiple)
const commentMulti = buildCommentEmail('Sam', [
  { ideaItemId: 'idea-1', ideaItemTitle: 'Add AI-powered code suggestions', commentContent: '<p>I think we should start with autocomplete before tackling full suggestions.</p>', commenterName: 'Laura Perez', itemLink: '/ideas?id=idea-1' },
  { ideaItemId: 'idea-2', ideaItemTitle: 'Redesign settings page', commentContent: '<p>The current layout is confusing for new users. Let me share some mockups.</p>', commenterName: 'Max Torres', itemLink: '/ideas?id=idea-2' },
], 'en');
emails.push({ title: 'Idea Comment — Multiple (EN)', ...commentMulti });

// 20. Idea Hub — Mention (single)
const mentionSingle = buildMentionEmail('Sam', [
  { ideaItemId: 'idea-1', ideaItemTitle: 'Add AI-powered code suggestions', commentContent: '<p>Hey <strong>@Teammate</strong>, can you review the feasibility of this approach?</p>', mentionerName: 'Alex Rivera', itemLink: '/ideas?id=idea-1' },
], 'en');
emails.push({ title: 'Idea Mention — Single (EN)', ...mentionSingle });

// 21. Idea Hub — Mention (multiple)
const mentionMulti = buildMentionEmail('Sam', [
  { ideaItemId: 'idea-1', ideaItemTitle: 'Add AI-powered code suggestions', commentContent: '<p>Hey <strong>@Teammate</strong>, can you review the feasibility?</p>', mentionerName: 'Alex Rivera', itemLink: '/ideas?id=idea-1' },
  { ideaItemId: 'idea-2', ideaItemTitle: 'Redesign settings page', commentContent: '<p><strong>@Teammate</strong> thoughts on this mockup?</p>', mentionerName: 'Laura Perez', itemLink: '/ideas?id=idea-2' },
], 'en');
emails.push({ title: 'Idea Mention — Multiple (EN)', ...mentionMulti });

// 22. Idea Hub — Status Changed (single)
const statusSingle = buildStatusChangedEmail('Sam', [
  { title: 'AI quota limit reached (80%)', body: 'Your workspace has used 80% of the monthly AI token quota. Consider upgrading or adjusting usage.', itemLink: '/settings/quota' },
], 'en');
emails.push({ title: 'Status Changed — Single (EN)', ...statusSingle });

// 23. Idea Hub — Status Changed (multiple)
const statusMulti = buildStatusChangedEmail('Sam', [
  { title: 'AI quota limit reached (80%)', body: 'Your workspace has used 80% of the monthly AI token quota.', itemLink: '/settings/quota' },
  { title: 'New member joined', body: 'Laura Perez has joined the workspace as a member.', itemLink: '/settings/members' },
], 'en');
emails.push({ title: 'Status Changed — Multiple (EN)', ...statusMulti });

// ---- Build preview HTML ----

const escapeForPreview = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const nav = emails
  .map((e, i) => `<a href="#email-${i}" style="display:block;padding:8px 16px;color:#374151;text-decoration:none;font-size:14px;border-radius:6px;transition:background 0.15s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">${escapeForPreview(e.title)}</a>`)
  .join('\n');

const sections = emails
  .map(
    (e, i) => `
    <div id="email-${i}" style="margin-bottom:64px;scroll-margin-top:20px;">
      <div style="margin-bottom:16px;padding:12px 20px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
        <h2 style="margin:0 0 4px;font-size:18px;color:#111827;">${escapeForPreview(e.title)}</h2>
        <p style="margin:0;font-size:13px;color:#6b7280;">Subject: <strong>${escapeForPreview(e.subject)}</strong></p>
      </div>
      <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <iframe srcdoc="${e.html.replace(/"/g, '&quot;')}" style="width:100%;height:650px;border:none;" sandbox></iframe>
      </div>
    </div>`,
  )
  .join('\n');

const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Almirant Email Previews</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; }
  </style>
</head>
<body>
  <div style="display:flex;min-height:100vh;">
    <!-- Sidebar -->
    <nav style="width:280px;min-width:280px;padding:24px 12px;border-right:1px solid #e5e7eb;position:sticky;top:0;height:100vh;overflow-y:auto;">
      <h1 style="margin:0 0 20px 16px;font-size:16px;font-weight:700;color:#111827;">Email Previews</h1>
      <p style="margin:0 0 16px 16px;font-size:12px;color:#9ca3af;">${emails.length} templates</p>
      ${nav}
    </nav>
    <!-- Content -->
    <main style="flex:1;padding:32px 40px;max-width:900px;">
      ${sections}
    </main>
  </div>
</body>
</html>`;

const outPath = import.meta.dir + '/../../email-previews.html';
await Bun.write(outPath, previewHtml);

console.log(`\n  ✔ Generated ${emails.length} email previews`);
console.log(`  → ${outPath}\n`);
