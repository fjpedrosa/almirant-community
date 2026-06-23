import { env } from "@almirant/config";

export function getFrontendBaseUrl(): string {
  const origins = (env.CORS_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return origins[0] ?? "http://localhost:3000";
}

export function getTelegramSecretHeader(request: Request): string {
  // Telegram uses: X-Telegram-Bot-Api-Secret-Token
  return (
    request.headers.get("x-telegram-bot-api-secret-token") ||
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") ||
    ""
  );
}

export function normalizeTelegramChatId(id: unknown): string | null {
  if (typeof id === "number") return String(id);
  if (typeof id === "bigint") return id.toString();
  if (typeof id === "string" && id.trim()) return id.trim();
  return null;
}

