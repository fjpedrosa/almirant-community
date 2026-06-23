import { describe, expect, it } from "bun:test";
import { MERGED_TOAST_DARK_CLASSNAMES } from "./toast-theme";

describe("merged toast theme", () => {
  it("uses a visible violet surface in dark mode instead of the near-black violet-950 token", () => {
    expect(MERGED_TOAST_DARK_CLASSNAMES.surface).toContain("dark:bg-violet-500/20");
    expect(MERGED_TOAST_DARK_CLASSNAMES.surface).toContain("dark:border-violet-400/50");
    expect(MERGED_TOAST_DARK_CLASSNAMES.surface).not.toContain("dark:bg-violet-950");
  });
});
