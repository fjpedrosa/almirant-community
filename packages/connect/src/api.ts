/**
 * HTTP client for the Almirant link-token API.
 *
 * Sends collected credentials back to the server so the connection
 * can be activated without the user having to copy-paste anything
 * into the dashboard.
 */

/**
 * Complete a link-token by posting the provider credentials.
 *
 * @param apiUrl  - Base URL of the Almirant API (no trailing slash).
 * @param linkToken - One-time link token issued by the dashboard.
 * @param credentials - Provider-specific credential payload.
 */
export const completeLinkToken = async (
  apiUrl: string,
  linkToken: string,
  credentials: Record<string, unknown>,
): Promise<void> => {
  let res: Response;

  try {
    res = await fetch(
      `${apiUrl}/api/connections/link-token/${linkToken}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials }),
      },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown network error";
    throw new Error(
      `Network error while contacting ${apiUrl}: ${message}\n` +
        "  Hint: check your internet connection and try again.",
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    const serverMsg =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as Record<string, unknown>).error)
        : `Server returned ${res.status}`;
    throw new Error(serverMsg);
  }
};
