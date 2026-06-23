const MARKDOWN_V2_SPECIAL_CHARS = /[_*\[\]()~`>#+\-=|{}.!]/g;

export const escapeTelegramMarkdownV2 = (input: string): string => {
  return input.replace(MARKDOWN_V2_SPECIAL_CHARS, "\\$&");
};

export const buildInlineUrlButton = (text: string, url: string) => {
  return {
    inline_keyboard: [[{ text, url }]],
  };
};

export const buildWorkItemMovedMessage = (args: {
  taskId: string | null;
  title: string;
  projectName: string | null;
  boardName: string | null;
  fromColumnName: string;
  toColumnName: string;
  url: string;
}) => {
  const taskId = args.taskId ? escapeTelegramMarkdownV2(args.taskId) : "WORK\\-ITEM";
  const title = escapeTelegramMarkdownV2(args.title);
  const projectName = escapeTelegramMarkdownV2(args.projectName ?? "");
  const boardName = escapeTelegramMarkdownV2(args.boardName ?? "");
  const fromColumnName = escapeTelegramMarkdownV2(args.fromColumnName);
  const toColumnName = escapeTelegramMarkdownV2(args.toColumnName);

  const text =
    `*🔄 Work item movido*\n` +
    `*${taskId}* ${title}\n` +
    `De: \`${fromColumnName}\`\n` +
    `A: \`${toColumnName}\`\n` +
    (projectName ? `Proyecto: ${projectName}\n` : "") +
    (boardName ? `Board: ${boardName}` : "");

  return {
    text,
    replyMarkup: buildInlineUrlButton("Ver en Almirant", args.url),
  };
};

export const buildWorkItemAssignedMessage = (args: {
  taskId: string | null;
  title: string;
  projectName: string | null;
  boardName: string | null;
  assignee: string;
  url: string;
}) => {
  const taskId = args.taskId ? escapeTelegramMarkdownV2(args.taskId) : "WORK\\-ITEM";
  const title = escapeTelegramMarkdownV2(args.title);
  const projectName = escapeTelegramMarkdownV2(args.projectName ?? "");
  const boardName = escapeTelegramMarkdownV2(args.boardName ?? "");
  const assignee = escapeTelegramMarkdownV2(args.assignee);

  const text =
    `*👤 Work item asignado*\n` +
    `*${taskId}* ${title}\n` +
    `Asignado a: *${assignee}*\n` +
    (projectName ? `Proyecto: ${projectName}\n` : "") +
    (boardName ? `Board: ${boardName}` : "");

  return {
    text,
    replyMarkup: buildInlineUrlButton("Ver en Almirant", args.url),
  };
};

export const buildWorkItemDoneMessage = (args: {
  taskId: string | null;
  title: string;
  projectName: string | null;
  boardName: string | null;
  url: string;
}) => {
  const taskId = args.taskId ? escapeTelegramMarkdownV2(args.taskId) : "WORK\\-ITEM";
  const title = escapeTelegramMarkdownV2(args.title);
  const projectName = escapeTelegramMarkdownV2(args.projectName ?? "");
  const boardName = escapeTelegramMarkdownV2(args.boardName ?? "");

  const text =
    `*✅ Work item completado*\n` +
    `*${taskId}* ${title}\n` +
    (projectName ? `Proyecto: ${projectName}\n` : "") +
    (boardName ? `Board: ${boardName}` : "");

  return {
    text,
    replyMarkup: buildInlineUrlButton("Ver en Almirant", args.url),
  };
};

export const buildReviewCompletedMessage = (args: {
  taskId: string | null;
  title: string;
  result: "pass" | "fail";
  summary: string;
  url: string;
}) => {
  const icon = args.result === "pass" ? "✅" : "❌";
  const taskId = args.taskId ? escapeTelegramMarkdownV2(args.taskId) : "WORK\\-ITEM";
  const title = escapeTelegramMarkdownV2(args.title);
  const summary = escapeTelegramMarkdownV2(args.summary.trim().slice(0, 400));

  const text =
    `*${icon} Review completado*\n` +
    `*${taskId}* ${title}\n` +
    (summary ? `Resumen: ${summary}` : "");

  return {
    text,
    replyMarkup: buildInlineUrlButton("Ver en Almirant", args.url),
  };
};

export const buildSprintClosedMessage = (args: {
  sprintName: string;
  completedCount: number;
  totalCount: number;
  boardName: string | null;
  url: string;
}) => {
  const sprintName = escapeTelegramMarkdownV2(args.sprintName);
  const boardName = escapeTelegramMarkdownV2(args.boardName ?? "");

  const text =
    `*📊 Sprint cerrado*\n` +
    `Sprint: *${sprintName}*\n` +
    `Completados: *${args.completedCount}/${args.totalCount}*\n` +
    (boardName ? `Board: ${boardName}` : "");

  return {
    text,
    replyMarkup: buildInlineUrlButton("Ver reporte", args.url),
  };
};

export const buildUserActionsMessage = (args: {
  taskId: string | null;
  title: string;
  userActions: string;
  url: string;
}) => {
  const taskId = args.taskId ? escapeTelegramMarkdownV2(args.taskId) : "WORK\\-ITEM";
  const title = escapeTelegramMarkdownV2(args.title);
  const firstLine = args.userActions
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  const snippet = escapeTelegramMarkdownV2((firstLine ?? args.userActions).slice(0, 300));

  const text =
    `*📌 Acciones requeridas*\n` +
    `*${taskId}* ${title}\n` +
    (snippet ? `\n${snippet}` : "");

  return {
    text,
    replyMarkup: buildInlineUrlButton("Ver en Almirant", args.url),
  };
};
