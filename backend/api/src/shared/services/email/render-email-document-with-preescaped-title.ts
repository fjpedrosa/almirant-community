import { escapeHtml, renderEmailDocument } from "./render-email-shell";

const escapedTitleBrand = Symbol("EscapedTitle");
export type EscapedTitle = { readonly [escapedTitleBrand]: true; readonly value: string };
export const escapedTitle = (strings: TemplateStringsArray, ...values: string[]): EscapedTitle => ({
  [escapedTitleBrand]: true,
  value: strings.reduce((result, string, index) => `${result}${string}${index < values.length ? escapeHtml(values[index]!) : ""}`, ""),
});

const titleMarker = "__ALMIRANT_PREESCAPED_TITLE__";

export const renderEmailDocumentWithPreescapedTitle = (args: {
  locale: string;
  title: EscapedTitle;
  body: string;
  bodyStyle?: string;
}): string => renderEmailDocument({
  locale: args.locale,
  title: titleMarker,
  body: args.body,
  bodyStyle: args.bodyStyle,
}).replace(`<title>${titleMarker}</title>`, () => `<title>${args.title.value}</title>`);
