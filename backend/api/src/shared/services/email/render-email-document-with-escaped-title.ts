import { renderEmailDocument } from "./render-email-shell";

const bodyStyle = "margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;";
const titleMarker = "__ALMIRANT_EMAIL_TITLE__";

const escapeTitle = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

export const renderEmailDocumentWithEscapedTitle = (args: {
  locale: string;
  title: string;
  body: string;
}): string => {
  const escapedTitle = escapeTitle(args.title);
  return renderEmailDocument({ locale: args.locale, title: titleMarker, body: args.body, bodyStyle })
    .replace(`<title>${titleMarker}</title>`, () => `<title>${escapedTitle}</title>`);
};
