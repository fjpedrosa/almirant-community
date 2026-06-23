import { db } from "../../client";
import { telegramUsers, telegramLinkCodes } from "../../schema/telegram";
import { eq, and, gt, isNull, sql } from "drizzle-orm";
import crypto from "crypto";

const DEFAULT_LINK_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function normalizeLinkCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateHumanCode(length = 10): string {
  // Crockford base32 without I/L/O/U to reduce confusion.
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const b = bytes[i] ?? 0;
    out += alphabet[b % alphabet.length];
  }
  return out;
}

export type TelegramLinkCodeCreateResult = {
  code: string;
  expiresAt: string;
};

export const getTelegramAccountByUserId = async (userId: string) => {
  const [result] = await db
    .select()
    .from(telegramUsers)
    .where(eq(telegramUsers.userId, userId))
    .limit(1);
  return result ?? null;
};

export const getTelegramAccountByChatId = async (chatId: string) => {
  const [result] = await db
    .select()
    .from(telegramUsers)
    .where(eq(telegramUsers.chatId, chatId))
    .limit(1);
  return result ?? null;
};

export const unlinkTelegramAccount = async (userId: string) => {
  const [deleted] = await db
    .delete(telegramUsers)
    .where(eq(telegramUsers.userId, userId))
    .returning();
  return deleted ?? null;
};

export const createTelegramLinkCode = async (
  userId: string,
  ttlMs = DEFAULT_LINK_CODE_TTL_MS
): Promise<TelegramLinkCodeCreateResult> => {
  const code = generateHumanCode(10);
  const normalized = normalizeLinkCode(code);
  const codeHash = sha256(normalized);
  const expiresAt = new Date(Date.now() + ttlMs);

  // Keep at most one active code per user by marking previous ones as used.
  await db
    .update(telegramLinkCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(telegramLinkCodes.userId, userId), isNull(telegramLinkCodes.usedAt)));

  await db.insert(telegramLinkCodes).values({
    userId,
    codeHash,
    expiresAt,
  });

  return { code: normalized, expiresAt: expiresAt.toISOString() };
};

export type TelegramConsumeLinkCodeResult =
  | { ok: true; userId: string; alreadyLinked?: boolean }
  | { ok: false; reason: "invalid_or_expired" | "chat_already_linked" | "user_already_linked" };

export const consumeTelegramLinkCode = async (args: {
  code: string;
  chatId: string;
  telegramUserId?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<TelegramConsumeLinkCodeResult> => {
  const normalized = normalizeLinkCode(args.code);
  if (!normalized) return { ok: false, reason: "invalid_or_expired" };

  const codeHash = sha256(normalized);
  const now = new Date();

  return await db.transaction(async (tx) => {
    // Atomically claim the code (single-use) and get the userId.
    const [claimed] = await tx
      .update(telegramLinkCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(telegramLinkCodes.codeHash, codeHash),
          isNull(telegramLinkCodes.usedAt),
          gt(telegramLinkCodes.expiresAt, now)
        )
      )
      .returning({ id: telegramLinkCodes.id, userId: telegramLinkCodes.userId });

    if (!claimed) return { ok: false, reason: "invalid_or_expired" };

    // Ensure chat isn't already linked (to any user).
    const [existingChatLink] = await tx
      .select()
      .from(telegramUsers)
      .where(eq(telegramUsers.chatId, args.chatId))
      .limit(1);

    if (existingChatLink) {
      // If it's already linked to the same user, treat as ok and mark code as used.
      if (existingChatLink.userId === claimed.userId) {
        return { ok: true, userId: claimed.userId, alreadyLinked: true };
      }
      return { ok: false, reason: "chat_already_linked" };
    }

    // Ensure user doesn't already have another chat linked.
    const [existingUserLink] = await tx
      .select()
      .from(telegramUsers)
      .where(eq(telegramUsers.userId, claimed.userId))
      .limit(1);

    if (existingUserLink) return { ok: false, reason: "user_already_linked" };

    await tx.insert(telegramUsers).values({
      userId: claimed.userId,
      chatId: args.chatId,
      telegramUserId: args.telegramUserId ?? null,
      username: args.username ?? null,
      firstName: args.firstName ?? null,
      lastName: args.lastName ?? null,
      linkedAt: now,
      createdAt: now,
    });

    // Best-effort cleanup: mark any other active codes for that user as used.
    await tx.execute(
      sql`UPDATE telegram_link_codes SET used_at = ${now} WHERE user_id = ${claimed.userId} AND used_at IS NULL`
    );

    return { ok: true, userId: claimed.userId };
  });
};
