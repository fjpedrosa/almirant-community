import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeCodeIcon } from "@/components/icons/claude-code-icon";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { GrokIcon } from "@/components/icons/grok-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OpenAIIcon } from "@/components/icons/openai-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { ZAIIcon } from "@/components/icons/zai-icon";
import {
  CODING_AGENT_ICON_MAP,
  PROVIDER_OPTIONS,
  getModelIconComponent,
  getProviderIconComponent,
} from "./provider-icons";

describe("provider icon mappings", () => {
  it("maps xAI provider aliases to the xAI icon instead of OpenAI", () => {
    expect(getProviderIconComponent("xai")).toBe(XAIIcon);
    expect(getProviderIconComponent("x.ai")).toBe(XAIIcon);
    expect(getProviderIconComponent("grok")).toBe(XAIIcon);
    expect(getProviderIconComponent("grok")).not.toBe(OpenAIIcon);
  });

  it("keeps Grok model names mapped to the Grok model icon", () => {
    expect(getModelIconComponent("grok-4.20-reasoning", "xai")).toBe(GrokIcon);
  });

  it("uses coding-agent icons for Claude Code, Codex and OpenCode", () => {
    expect(CODING_AGENT_ICON_MAP["claude-code"]).toBe(ClaudeCodeIcon);
    expect(CODING_AGENT_ICON_MAP.codex).toBe(CodexIcon);
    expect(CODING_AGENT_ICON_MAP.opencode).toBe(OpenCodeIcon);
  });

  it("offers xAI as the Grok-backed agent provider option with the xAI icon", () => {
    expect(PROVIDER_OPTIONS.find((option) => option.provider === "grok")).toEqual(
      expect.objectContaining({ label: "xAI", Icon: XAIIcon }),
    );
  });

  it("renders Codex as the monochrome public asset converted to an app icon", () => {
    const markup = renderToStaticMarkup(<CodexIcon className="size-4" />);

    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain("M8.086.457");
    expect(markup).not.toContain("linearGradient");
    expect(markup).not.toContain("url(#");
  });

  it("renders z.ai as the monochrome public asset converted to an app icon", () => {
    const markup = renderToStaticMarkup(<ZAIIcon className="size-4" />);

    expect(markup).toContain('aria-label="z.ai"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain("M12.105 2");
    expect(markup).not.toContain('fill="#2D2D2D"');
  });

  it("renders OpenCode as the monochrome public asset converted to an app icon", () => {
    const markup = renderToStaticMarkup(<OpenCodeIcon className="size-4" />);

    expect(markup).toContain('aria-label="OpenCode"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain("M384 416H128V96H384V416Z");
    expect(markup).not.toContain('stroke="currentColor"');
  });

  it("renders Claude Code with the dedicated Claude Code public asset", () => {
    const markup = renderToStaticMarkup(<ClaudeCodeIcon className="size-4" />);

    expect(markup).toContain('aria-label="Claude Code"');
    expect(markup).toContain('fill="#D97757"');
    expect(markup).toContain("M20.998 10.949H24");
  });

  it("uses Claude, not Anthropic, for Claude model icons", () => {
    expect(getModelIconComponent("claude-opus-4-7", "claude-code")).toBe(
      ClaudeIcon,
    );
    expect(getModelIconComponent("glm-5.1", "claude-code")).toBe(ZAIIcon);
    expect(getModelIconComponent("glm-5.1", "zipu")).toBe(ZAIIcon);
  });
});
