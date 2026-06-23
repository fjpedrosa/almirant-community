const DANGLING_BACKTICK_LINE_PATTERN = /^[\t ]*`{1,2}[\t ]*$/;

/**
 * Remove low-signal markdown backtick fragments that some runtimes emit as
 * standalone text between reasoning/tool blocks and the next assistant text.
 *
 * This intentionally targets only one/two-backtick boundary lines. Triple
 * backtick fences are left intact because they may be valid markdown code
 * blocks.
 */
export const stripDanglingBacktickBoundaryLines = (content: string): string => {
  const lines = content.split(/\r?\n/);

  while (lines.length > 0 && DANGLING_BACKTICK_LINE_PATTERN.test(lines[0] ?? "")) {
    lines.shift();
  }

  while (
    lines.length > 0 &&
    DANGLING_BACKTICK_LINE_PATTERN.test(lines[lines.length - 1] ?? "")
  ) {
    lines.pop();
  }

  return lines.join("\n");
};
