import { describe, expect, it } from "bun:test";
import { tiptapHtmlToEmailHtml } from "../domains/notifications/services/tiptap-html-to-email";

describe("tiptapHtmlToEmailHtml", () => {
  it("decodes HTML-escaped TipTap content before converting", () => {
    const html = "&lt;p&gt;Hola &lt;strong&gt;equipo&lt;/strong&gt;&lt;/p&gt;";

    const result = tiptapHtmlToEmailHtml(html);

    expect(result).toContain('<p style="margin:0 0 8px;line-height:1.5;">');
    expect(result).toContain("<strong>equipo</strong>");
    expect(result).not.toContain("&lt;p&gt;");
  });

  it("unwraps JSON-stringified HTML payloads", () => {
    const html = JSON.stringify("<p>Hola</p>");

    const result = tiptapHtmlToEmailHtml(html);

    expect(result).toContain('<p style="margin:0 0 8px;line-height:1.5;">Hola</p>');
  });

  it("renders mentions and image tags as email-safe HTML", () => {
    const html =
      '<p>Hola <span data-type="mention" data-id="u1">@Ana</span></p><img src="https://cdn.example.com/a.png" alt="Captura" />';

    const result = tiptapHtmlToEmailHtml(html);

    expect(result).toContain('<strong style="color:#6366f1;">@Ana</strong>');
    expect(result).toContain('<a href="https://cdn.example.com/a.png" target="_blank" rel="noopener noreferrer">');
    expect(result).toContain('<img src="https://cdn.example.com/a.png" alt="Captura"');
  });

  it("drops unsupported image protocols", () => {
    const html = '<p>Hola</p><img src="javascript:alert(1)" alt="X" />';

    const result = tiptapHtmlToEmailHtml(html);

    expect(result).toContain("Hola");
    expect(result).not.toContain("<img");
    expect(result).not.toContain("javascript:alert(1)");
  });
});
