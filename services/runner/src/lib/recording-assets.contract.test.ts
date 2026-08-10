import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CURSOR_OVERLAY_SCRIPT,
  TOUCH_OVERLAY_SCRIPT,
} from "./recording-overlays";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const recordingLibraryRoot = import.meta.dir;
const resolverPath = resolve(recordingLibraryRoot, "resolve-recording-url.ts");
const overlayPath = resolve(recordingLibraryRoot, "recording-overlays.ts");
const recordVideoSkillPath = resolve(
  repositoryRoot,
  ".agents/skills/record-video/SKILL.md",
);
const overlaySkillClause = [
  "1. Read `services/runner/src/lib/recording-overlays.ts` to obtain the overlay scripts.",
  "2. Choose the script based on `walkthrough.viewport`:",
  "   - `desktop` -> use `CURSOR_OVERLAY_SCRIPT` (red tracking dot that pulses on click)",
  "   - `mobile` -> use `TOUCH_OVERLAY_SCRIPT` (expanding blue ripple on each tap/click)",
].join("\n");

describe("recording asset source contract", () => {
  test("keeps issue #123's orphan resolver absent and the live overlay integration intact", () => {
    expect(existsSync(resolverPath)).toBe(false);
    expect(existsSync(overlayPath)).toBe(true);
    expect(typeof CURSOR_OVERLAY_SCRIPT).toBe("string");
    expect(CURSOR_OVERLAY_SCRIPT.trim().length).toBeGreaterThan(0);
    expect(CURSOR_OVERLAY_SCRIPT).toContain("__walkthrough-cursor");
    expect(typeof TOUCH_OVERLAY_SCRIPT).toBe("string");
    expect(TOUCH_OVERLAY_SCRIPT.trim().length).toBeGreaterThan(0);
    expect(TOUCH_OVERLAY_SCRIPT).toContain("__walkthroughTouchOverlay");

    const recordVideoSkill = readFileSync(recordVideoSkillPath, "utf8");
    expect(recordVideoSkill).toContain(overlaySkillClause);
  });
});
