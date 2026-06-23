export const parseManualOAuthCode = (
  rawInput: string,
): { code: string; state: string | null } => {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return { code: "", state: null };
  }

  const parseSearchParams = (value: string): { code: string; state: string | null } | null => {
    const params = new URLSearchParams(value.replace(/^[?#]/, ""));
    const code = params.get("code")?.trim();

    if (!code) {
      return null;
    }

    return {
      code,
      state: params.get("state")?.trim() ?? null,
    };
  };

  try {
    const url = new URL(trimmed);
    const fromSearch = parseSearchParams(url.search);
    if (fromSearch) {
      return fromSearch;
    }

    const fromHash = parseSearchParams(url.hash);
    if (fromHash) {
      return fromHash;
    }
  } catch {
    // Fall through to manual parsing for raw codes and fragments.
  }

  const fromInlineParams = parseSearchParams(trimmed);
  if (fromInlineParams) {
    return fromInlineParams;
  }

  if (trimmed.includes("#")) {
    const [code, state] = trimmed.split("#", 2);
    return {
      code: code?.trim() ?? trimmed,
      state: state?.trim() || null,
    };
  }

  return { code: trimmed, state: null };
};
