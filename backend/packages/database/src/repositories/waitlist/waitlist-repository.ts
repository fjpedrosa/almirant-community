import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, ilike, isNull, lt, or, sql, desc, asc, isNotNull } from "drizzle-orm";
import { db } from "../../client";
import {
  waitlistActions,
  waitlistEmailTokens,
  waitlistReferrals,
  waitlistUsers,
  waitlistThankYouSends,
  type WaitlistUser,
  type WaitlistAction,
  type WaitlistThankYouSend,
} from "../../schema";

// ---------------------------------------------------------------------------
// Admin Types
// ---------------------------------------------------------------------------

export interface AdminWaitlistFilters {
  search?: string;
  status?: string;
  tier?: string;
  profileRole?: string;
  sortBy?: "createdAt" | "confirmedAt" | "points";
  sortOrder?: "asc" | "desc";
}

export interface AdminWaitlistStats {
  total: number;
  confirmed: number;
  pending: number;
  byTier: { tier: string; count: number }[];
  profileCompletionRate: number;
  referralCount: number;
}

export interface DistributionItem {
  label: string;
  value: number;
  percentage?: number;
}

export interface AdminWaitlistAnalytics {
  roleDistribution: DistributionItem[];
  aiStackDistribution: DistributionItem[];
  vibeToolDistribution: DistributionItem[];
  monthlySpendDistribution: DistributionItem[];
  featureInterestCounts: DistributionItem[];
  signupsPerDay: { date: string; count: number }[];
}

interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

type WaitlistTier = typeof waitlistUsers.tier.enumValues[number];
type WaitlistActionType = typeof waitlistActions.actionType.enumValues[number];
type WaitlistEmailTokenType = typeof waitlistEmailTokens.tokenType.enumValues[number];

const WAITLIST_REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const WAITLIST_POINTS = {
  EMAIL_CONFIRMED: 10,
  PROFILE_STEP: 5,
  FEATURES_SELECTED: 5,
  SHARE_X: 5,
  SHARE_LINKEDIN: 5,
  REFERRAL_CONFIRMED: 20,
  PIONEER_PAYMENT: 500,
} as const;

const WAITLIST_TIER_THRESHOLDS: Array<{ tier: WaitlistTier; minPoints: number }> = [
  { tier: "none", minPoints: 0 },
  { tier: "early_access", minPoints: 10 },
  { tier: "supporter", minPoints: 40 },
  { tier: "pioneer", minPoints: 500 },
];

const normalizeValue = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const normalizeEmail = (email: string): string => {
  return email.trim().toLowerCase();
};

const hashToken = (token: string): string => {
  return createHash("sha256").update(token).digest("hex");
};

const generateReferralCodeCandidate = (length = 8): string => {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * WAITLIST_REFERRAL_CODE_ALPHABET.length);
    code += WAITLIST_REFERRAL_CODE_ALPHABET[index];
  }
  return code;
};

const generateUniqueReferralCode = async (): Promise<string> => {
  for (let i = 0; i < 12; i += 1) {
    const candidate = generateReferralCodeCandidate();
    const [existing] = await db
      .select({ id: waitlistUsers.id })
      .from(waitlistUsers)
      .where(eq(waitlistUsers.referralCode, candidate))
      .limit(1);
    if (!existing) return candidate;
  }

  throw new Error("Failed to generate unique referral code");
};

const getTierForPoints = (points: number): WaitlistTier => {
  if (points >= 500) return "pioneer";
  if (points >= 40) return "supporter";
  if (points >= 10) return "early_access";
  return "none";
};

const getNextTierInfo = (points: number) => {
  const sorted = [...WAITLIST_TIER_THRESHOLDS].sort((a, b) => a.minPoints - b.minPoints);
  const currentTier = getTierForPoints(points);
  const currentIndex = sorted.findIndex((item) => item.tier === currentTier);
  const next = sorted[currentIndex + 1];

  if (!next) {
    return {
      currentTier,
      nextTier: null,
      currentPoints: points,
      targetPoints: points,
      pointsToNextTier: 0,
      progressPercent: 100,
    };
  }

  const currentMin = sorted[currentIndex]?.minPoints ?? 0;
  const span = Math.max(1, next.minPoints - currentMin);
  const progressed = Math.max(0, Math.min(span, points - currentMin));

  return {
    currentTier,
    nextTier: next.tier,
    currentPoints: points,
    targetPoints: next.minPoints,
    pointsToNextTier: Math.max(0, next.minPoints - points),
    progressPercent: Math.round((progressed / span) * 100),
  };
};

export const getWaitlistUserById = async (id: string) => {
  const [row] = await db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.id, id))
    .limit(1);

  return row ?? null;
};

export const getWaitlistUserByEmail = async (email: string) => {
  const emailNormalized = normalizeEmail(email);
  const [row] = await db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.emailNormalized, emailNormalized))
    .limit(1);

  return row ?? null;
};

export const getWaitlistUserByReferralCode = async (referralCode: string) => {
  const code = referralCode.trim().toUpperCase();
  const [row] = await db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.referralCode, code))
    .limit(1);

  return row ?? null;
};

export interface UpsertWaitlistSignupInput {
  email: string;
  name?: string | null;
  locale?: string | null;
  referralCode?: string | null;
  referralSource?: "query" | "cookie" | "form" | "unknown";
  profileRole?: string | null;
  profileAiStack?: string[] | null;
  profileAiStackOther?: string | null;
  profileVibeTool?: string[] | null;
  profileMonthlySpend?: string | null;
  profileFeatures?: string[] | null;
}

export const createWaitlistReferral = async (args: {
  referrerUserId: string;
  referredUserId: string;
  source?: string;
}) => {
  if (args.referrerUserId === args.referredUserId) return null;

  const [created] = await db
    .insert(waitlistReferrals)
    .values({
      referrerUserId: args.referrerUserId,
      referredUserId: args.referredUserId,
      source: normalizeValue(args.source) ?? "unknown",
    })
    .onConflictDoNothing({
      target: waitlistReferrals.referredUserId,
    })
    .returning();

  if (created) return created;

  const [existing] = await db
    .select()
    .from(waitlistReferrals)
    .where(eq(waitlistReferrals.referredUserId, args.referredUserId))
    .limit(1);

  return existing ?? null;
};

export const upsertWaitlistSignup = async (input: UpsertWaitlistSignupInput) => {
  const emailNormalized = normalizeEmail(input.email);
  const now = new Date();
  const normalizedName = normalizeValue(input.name);
  const profileRole = normalizeValue(input.profileRole);
  const profileAiStack = input.profileAiStack?.length ? input.profileAiStack : null;
  const profileAiStackOther = normalizeValue(input.profileAiStackOther);
  const profileVibeTool = input.profileVibeTool?.length ? input.profileVibeTool : null;
  const profileMonthlySpend = normalizeValue(input.profileMonthlySpend);
  const profileFeatures = input.profileFeatures?.length ? input.profileFeatures : null;
  const locale = normalizeValue(input.locale);

  const [existing] = await db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.emailNormalized, emailNormalized))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(waitlistUsers)
      .set({
        name: normalizedName ?? existing.name,
        profileRole: profileRole ?? existing.profileRole,
        profileAiStack: profileAiStack ?? existing.profileAiStack,
        profileAiStackOther: profileAiStackOther ?? existing.profileAiStackOther,
        profileVibeTool: profileVibeTool ?? existing.profileVibeTool,
        profileMonthlySpend: profileMonthlySpend ?? existing.profileMonthlySpend,
        profileFeatures: profileFeatures ?? existing.profileFeatures,
        locale: locale ?? existing.locale,
        updatedAt: now,
      })
      .where(eq(waitlistUsers.id, existing.id))
      .returning();

    return {
      user: updated ?? existing,
      isNew: false,
    };
  }

  const referralCode = await generateUniqueReferralCode();

  const [created] = await db
    .insert(waitlistUsers)
    .values({
      email: input.email.trim(),
      emailNormalized,
      name: normalizedName,
      locale: locale ?? "en",
      status: "pending",
      referralCode,
      profileRole,
      profileAiStack,
      profileAiStackOther,
      profileVibeTool,
      profileMonthlySpend,
      profileFeatures,
      points: 0,
      tier: "none",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create waitlist user");
  }

  const inboundReferral = normalizeValue(input.referralCode)?.toUpperCase();
  if (inboundReferral) {
    const referrer = await getWaitlistUserByReferralCode(inboundReferral);
    if (
      referrer &&
      referrer.id !== created.id &&
      referrer.emailNormalized !== created.emailNormalized
    ) {
      await createWaitlistReferral({
        referrerUserId: referrer.id,
        referredUserId: created.id,
        source: input.referralSource ?? "unknown",
      });
    }
  }

  return {
    user: created,
    isNew: true,
  };
};

export const createWaitlistEmailToken = async (args: {
  userId: string;
  tokenType?: WaitlistEmailTokenType;
  ttlMinutes?: number;
}) => {
  const tokenType = args.tokenType ?? "confirm_email";
  const ttlMinutes = args.ttlMinutes ?? 60 * 24;
  const token = randomBytes(24).toString("hex");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  await db
    .update(waitlistEmailTokens)
    .set({
      consumedAt: now,
    })
    .where(
      and(
        eq(waitlistEmailTokens.userId, args.userId),
        eq(waitlistEmailTokens.tokenType, tokenType),
        isNull(waitlistEmailTokens.consumedAt)
      )
    );

  const [created] = await db
    .insert(waitlistEmailTokens)
    .values({
      userId: args.userId,
      tokenHash,
      tokenType,
      expiresAt,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create waitlist email token");
  }

  return {
    token,
    tokenHash,
    expiresAt,
    record: created,
  };
};

export const consumeWaitlistEmailToken = async (args: {
  token: string;
  tokenType?: WaitlistEmailTokenType;
}) => {
  const tokenType = args.tokenType ?? "confirm_email";
  const tokenHash = hashToken(args.token);
  const now = new Date();

  const [match] = await db
    .select({
      token: waitlistEmailTokens,
      user: waitlistUsers,
    })
    .from(waitlistEmailTokens)
    .innerJoin(waitlistUsers, eq(waitlistEmailTokens.userId, waitlistUsers.id))
    .where(
      and(
        eq(waitlistEmailTokens.tokenHash, tokenHash),
        eq(waitlistEmailTokens.tokenType, tokenType),
        isNull(waitlistEmailTokens.consumedAt),
        gt(waitlistEmailTokens.expiresAt, now)
      )
    )
    .limit(1);

  if (!match) return null;

  const [consumed] = await db
    .update(waitlistEmailTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(waitlistEmailTokens.id, match.token.id),
        isNull(waitlistEmailTokens.consumedAt)
      )
    )
    .returning();

  if (!consumed) return null;

  return {
    token: consumed,
    user: match.user,
  };
};

export const confirmWaitlistUser = async (userId: string) => {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.id, userId))
    .limit(1);

  if (!existing) return null;
  if (existing.status === "confirmed") return existing;

  const [updated] = await db
    .update(waitlistUsers)
    .set({
      status: "confirmed",
      confirmedAt: now,
      updatedAt: now,
    })
    .where(eq(waitlistUsers.id, userId))
    .returning();

  return updated ?? existing;
};

export const markWaitlistReferralConfirmed = async (referredUserId: string) => {
  const now = new Date();
  const [updated] = await db
    .update(waitlistReferrals)
    .set({ confirmedAt: now })
    .where(
      and(
        eq(waitlistReferrals.referredUserId, referredUserId),
        isNull(waitlistReferrals.confirmedAt)
      )
    )
    .returning();

  if (updated) return updated;

  const [existing] = await db
    .select()
    .from(waitlistReferrals)
    .where(eq(waitlistReferrals.referredUserId, referredUserId))
    .limit(1);

  return existing ?? null;
};

export const addWaitlistActionPoints = async (args: {
  userId: string;
  actionType: WaitlistActionType;
  dedupeKey: string;
  points: number;
  metadata?: Record<string, unknown>;
}) => {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [insertedAction] = await tx
      .insert(waitlistActions)
      .values({
        userId: args.userId,
        actionType: args.actionType,
        dedupeKey: args.dedupeKey,
        points: args.points,
        metadata: args.metadata ?? {},
      })
      .onConflictDoNothing({
        target: waitlistActions.dedupeKey,
      })
      .returning();

    if (!insertedAction) {
      const [currentUser] = await tx
        .select()
        .from(waitlistUsers)
        .where(eq(waitlistUsers.id, args.userId))
        .limit(1);

      return {
        awarded: false,
        pointsAwarded: 0,
        action: null,
        user: currentUser ?? null,
      };
    }

    const [currentUser] = await tx
      .select()
      .from(waitlistUsers)
      .where(eq(waitlistUsers.id, args.userId))
      .limit(1);

    if (!currentUser) {
      throw new Error("Waitlist user not found while awarding points");
    }

    const nextPoints = currentUser.points + args.points;
    const nextTier = getTierForPoints(nextPoints);

    const [updatedUser] = await tx
      .update(waitlistUsers)
      .set({
        points: nextPoints,
        tier: nextTier,
        updatedAt: now,
      })
      .where(eq(waitlistUsers.id, args.userId))
      .returning();

    return {
      awarded: true,
      pointsAwarded: args.points,
      action: insertedAction,
      user: updatedUser ?? currentUser,
    };
  });
};

export const awardEmailConfirmedPoints = async (userId: string) => {
  return addWaitlistActionPoints({
    userId,
    actionType: "email_confirmed",
    dedupeKey: `email_confirmed:${userId}`,
    points: WAITLIST_POINTS.EMAIL_CONFIRMED,
  });
};

export const awardReferralConfirmedPoints = async (args: {
  referrerUserId: string;
  referredUserId: string;
}) => {
  return addWaitlistActionPoints({
    userId: args.referrerUserId,
    actionType: "referral_confirmed",
    dedupeKey: `referral_confirmed:${args.referrerUserId}:${args.referredUserId}`,
    points: WAITLIST_POINTS.REFERRAL_CONFIRMED,
    metadata: { referredUserId: args.referredUserId },
  });
};

export const awardSharePoints = async (args: {
  userId: string;
  platform: "x" | "linkedin";
}) => {
  if (args.platform === "x") {
    return addWaitlistActionPoints({
      userId: args.userId,
      actionType: "share_x",
      dedupeKey: `share_x:${args.userId}`,
      points: WAITLIST_POINTS.SHARE_X,
    });
  }

  return addWaitlistActionPoints({
    userId: args.userId,
    actionType: "share_linkedin",
    dedupeKey: `share_linkedin:${args.userId}`,
    points: WAITLIST_POINTS.SHARE_LINKEDIN,
  });
};

export const updateWaitlistProfile = async (args: {
  userId: string;
  profileRole?: string | null;
  profileAiStack?: string[] | null;
  profileAiStackOther?: string | null;
  profileVibeTool?: string[] | null;
  profileMonthlySpend?: string | null;
  profileFeatures?: string[] | null;
}) => {
  const now = new Date();

  const setFields: Record<string, unknown> = { updatedAt: now };
  if (args.profileRole != null) setFields.profileRole = args.profileRole.trim();
  if (args.profileAiStack != null) setFields.profileAiStack = args.profileAiStack.length ? args.profileAiStack : null;
  if (args.profileAiStackOther !== undefined) setFields.profileAiStackOther = normalizeValue(args.profileAiStackOther);
  if (args.profileVibeTool !== undefined) setFields.profileVibeTool = args.profileVibeTool?.length ? args.profileVibeTool : null;
  if (args.profileMonthlySpend != null) setFields.profileMonthlySpend = args.profileMonthlySpend.trim();
  if (args.profileFeatures !== undefined) setFields.profileFeatures = args.profileFeatures?.length ? args.profileFeatures : null;

  const [updated] = await db
    .update(waitlistUsers)
    .set(setFields)
    .where(eq(waitlistUsers.id, args.userId))
    .returning();

  if (!updated) return { user: null, totalPointsAwarded: 0 };

  // Award 5 pts per individual profile field (deduped per field)
  let totalPointsAwarded = 0;
  let latestUser = updated;

  const fieldAwards: Array<{ key: string; provided: boolean }> = [
    { key: "profile_role", provided: args.profileRole != null && !!args.profileRole.trim() },
    { key: "profile_ai_stack", provided: !!args.profileAiStack?.length },
    { key: "profile_vibe_tool", provided: !!args.profileVibeTool?.length },
    { key: "profile_monthly_spend", provided: args.profileMonthlySpend != null && !!args.profileMonthlySpend.trim() },
  ];

  for (const { key, provided } of fieldAwards) {
    if (provided) {
      const result = await addWaitlistActionPoints({
        userId: updated.id,
        actionType: "profile_completed",
        dedupeKey: `${key}:${updated.id}`,
        points: WAITLIST_POINTS.PROFILE_STEP,
      });
      if (result.awarded) {
        totalPointsAwarded += result.pointsAwarded;
        latestUser = result.user ?? latestUser;
      }
    }
  }

  // Features: 5 pts when any features selected (single dedup)
  if (updated.profileFeatures && (updated.profileFeatures as string[]).length > 0) {
    const result = await addWaitlistActionPoints({
      userId: updated.id,
      actionType: "features_selected",
      dedupeKey: `features_selected:${updated.id}`,
      points: WAITLIST_POINTS.FEATURES_SELECTED,
    });
    if (result.awarded) {
      totalPointsAwarded += result.pointsAwarded;
      latestUser = result.user ?? latestUser;
    }
  }

  // Mark profile as completed when all core fields are set
  const profileReady =
    !!normalizeValue(updated.profileRole) &&
    !!(updated.profileAiStack as string[] | null)?.length &&
    !!normalizeValue(updated.profileMonthlySpend);

  if (profileReady && !updated.profileCompletedAt) {
    const [dated] = await db
      .update(waitlistUsers)
      .set({ profileCompletedAt: now, updatedAt: now })
      .where(eq(waitlistUsers.id, updated.id))
      .returning();
    latestUser = dated ?? latestUser;
  }

  return { user: latestUser, totalPointsAwarded };
};

export const getWaitlistActionTypesByUserId = async (userId: string) => {
  const rows = await db
    .select({
      actionType: waitlistActions.actionType,
    })
    .from(waitlistActions)
    .where(eq(waitlistActions.userId, userId));

  return new Set(rows.map((row) => row.actionType));
};

export const touchWaitlistUserSeenAt = async (userId: string) => {
  const [updated] = await db
    .update(waitlistUsers)
    .set({
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(waitlistUsers.id, userId))
    .returning();

  return updated ?? null;
};

export const getWaitlistReferrerByReferredUserId = async (referredUserId: string) => {
  const [row] = await db
    .select({
      referral: waitlistReferrals,
      referrer: waitlistUsers,
    })
    .from(waitlistReferrals)
    .innerJoin(waitlistUsers, eq(waitlistReferrals.referrerUserId, waitlistUsers.id))
    .where(eq(waitlistReferrals.referredUserId, referredUserId))
    .limit(1);

  return row ?? null;
};

export const getWaitlistDashboardByUserId = async (args: {
  userId: string;
  appBaseUrl: string;
}) => {
  const [user] = await db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.id, args.userId))
    .limit(1);

  if (!user) return null;

  const [confirmedCountRows, confirmedReferralsRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(waitlistUsers)
      .where(eq(waitlistUsers.status, "confirmed")),
    db
      .select({ value: count() })
      .from(waitlistReferrals)
      .where(
        and(
          eq(waitlistReferrals.referrerUserId, args.userId),
          sql`${waitlistReferrals.confirmedAt} is not null`
        )
      ),
  ]);

  let position: number | null = null;
  if (user.status === "confirmed" && user.confirmedAt) {
    const [ahead] = await db
      .select({ value: count() })
      .from(waitlistUsers)
      .where(
        and(
          eq(waitlistUsers.status, "confirmed"),
          or(
            lt(waitlistUsers.confirmedAt, user.confirmedAt),
            and(
              eq(waitlistUsers.confirmedAt, user.confirmedAt),
              lt(waitlistUsers.createdAt, user.createdAt)
            )
          )
        )
      );

    position = (ahead?.value ?? 0) + 1;
  }

  const actionTypes = await getWaitlistActionTypesByUserId(args.userId);
  const nextTier = getNextTierInfo(user.points);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      referralCode: user.referralCode,
      points: user.points,
      tier: user.tier,
      confirmedAt: user.confirmedAt,
      profileRole: user.profileRole,
      profileAiStack: user.profileAiStack,
      profileAiStackOther: user.profileAiStackOther,
      profileVibeTool: user.profileVibeTool,
      profileMonthlySpend: user.profileMonthlySpend,
      profileFeatures: user.profileFeatures as string[] | null,
      profileCompletedAt: user.profileCompletedAt,
    },
    ranking: {
      position,
      confirmedUsers: confirmedCountRows[0]?.value ?? 0,
    },
    referrals: {
      confirmedCount: confirmedReferralsRows[0]?.value ?? 0,
      referralLink: `${args.appBaseUrl.replace(/\/+$/, "")}?ref=${user.referralCode}`,
    },
    actions: {
      emailConfirmed: actionTypes.has("email_confirmed"),
      profileCompleted: actionTypes.has("profile_completed"),
      featuresSelected: actionTypes.has("features_selected"),
      sharedX: actionTypes.has("share_x"),
      sharedLinkedin: actionTypes.has("share_linkedin"),
      pioneerPayment: actionTypes.has("pioneer_payment"),
    },
    tiers: nextTier,
  };
};

export const getRecentConfirmedWaitlistUsers = async (limit = 50) => {
  return db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.status, "confirmed"))
    .orderBy(sql`${waitlistUsers.confirmedAt} desc nulls last`)
    .limit(limit);
};


export interface WaitlistUserDetail {
  user: WaitlistUser;
  referrer: { name: string | null; email: string; referralCode: string } | null;
  actions: (WaitlistAction & { createdAt: Date })[];
  position: number;
}

export const getWaitlistUserDetailById = async (userId: string): Promise<WaitlistUserDetail | null> => {
  // Get the user
  const user = await getWaitlistUserById(userId);
  if (!user) return null;

  // Get referrer info via LEFT JOIN
  const [referrerRow] = await db
    .select({
      name: waitlistUsers.name,
      email: waitlistUsers.email,
      referralCode: waitlistUsers.referralCode,
    })
    .from(waitlistReferrals)
    .innerJoin(waitlistUsers, eq(waitlistReferrals.referrerUserId, waitlistUsers.id))
    .where(eq(waitlistReferrals.referredUserId, userId))
    .limit(1);

  const referrer = referrerRow ?? null;

  // Get all actions for user, ordered by createdAt DESC
  const actions = await db
    .select()
    .from(waitlistActions)
    .where(eq(waitlistActions.userId, userId))
    .orderBy(sql`${waitlistActions.createdAt} DESC`);

  // Calculate position: COUNT users with more points + 1
  const [usersWithMorePoints] = await db
    .select({ value: count() })
    .from(waitlistUsers)
    .where(gt(waitlistUsers.points, user.points));

  const position = (usersWithMorePoints?.value ?? 0) + 1;

  return {
    user,
    referrer,
    actions: actions.map((action) => ({
      ...action,
      createdAt: action.createdAt,
    })),
    position,
  };
};

// ---------------------------------------------------------------------------
// Admin Repository Functions
// ---------------------------------------------------------------------------

/**
 * List waitlist users with pagination, search, filters, and sorting.
 */
export const listAdminWaitlistUsers = async (
  pagination: PaginationParams,
  filters?: AdminWaitlistFilters
) => {
  const conditions = [];

  if (filters?.search) {
    conditions.push(
      or(
        ilike(waitlistUsers.email, `%${filters.search}%`),
        ilike(waitlistUsers.name, `%${filters.search}%`)
      )
    );
  }

  if (filters?.status) {
    conditions.push(eq(waitlistUsers.status, filters.status as typeof waitlistUsers.status.enumValues[number]));
  }

  if (filters?.tier) {
    conditions.push(eq(waitlistUsers.tier, filters.tier as typeof waitlistUsers.tier.enumValues[number]));
  }

  if (filters?.profileRole) {
    conditions.push(eq(waitlistUsers.profileRole, filters.profileRole));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const sortColumnMap = {
    createdAt: waitlistUsers.createdAt,
    confirmedAt: waitlistUsers.confirmedAt,
    points: waitlistUsers.points,
  } as const;

  const sortColumn = sortColumnMap[filters?.sortBy ?? "createdAt"];
  const orderFn = filters?.sortOrder === "asc" ? asc : desc;

  const thankYouSubquery = db
    .select({
      userId: waitlistThankYouSends.userId,
      thankYouTier: waitlistThankYouSends.tier,
      thankYouSentAt: waitlistThankYouSends.sentAt,
      thankYouDeliveryStatus: waitlistThankYouSends.deliveryStatus,
    })
    .from(waitlistThankYouSends)
    .as("ty");

  const [usersResult, countResult] = await Promise.all([
    db
      .select({
        id: waitlistUsers.id,
        email: waitlistUsers.email,
        name: waitlistUsers.name,
        status: waitlistUsers.status,
        tier: waitlistUsers.tier,
        points: waitlistUsers.points,
        referralCode: waitlistUsers.referralCode,
        locale: waitlistUsers.locale,
        profileRole: waitlistUsers.profileRole,
        profileAiStack: waitlistUsers.profileAiStack,
        profileAiStackOther: waitlistUsers.profileAiStackOther,
        profileVibeTool: waitlistUsers.profileVibeTool,
        profileMonthlySpend: waitlistUsers.profileMonthlySpend,
        profileFeatures: waitlistUsers.profileFeatures,
        profileCompletedAt: waitlistUsers.profileCompletedAt,
        confirmedAt: waitlistUsers.confirmedAt,
        createdAt: waitlistUsers.createdAt,
        thankYouTier: thankYouSubquery.thankYouTier,
        thankYouSentAt: thankYouSubquery.thankYouSentAt,
        thankYouDeliveryStatus: thankYouSubquery.thankYouDeliveryStatus,
      })
      .from(waitlistUsers)
      .leftJoin(thankYouSubquery, eq(waitlistUsers.id, thankYouSubquery.userId))
      .where(whereClause)
      .orderBy(orderFn(sortColumn))
      .limit(pagination.limit)
      .offset(pagination.offset),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(waitlistUsers)
      .where(whereClause),
  ]);

  return {
    users: usersResult,
    total: countResult[0]?.count ?? 0,
  };
};

/**
 * Aggregate statistics about waitlist users.
 */
export const getAdminWaitlistStats = async (): Promise<AdminWaitlistStats> => {
  const [totalResult, confirmedResult, pendingResult, byTierResult, profileCompletedResult, referralCountResult] =
    await Promise.all([
      // Total users
      db.select({ count: count() }).from(waitlistUsers),

      // Confirmed users
      db
        .select({ count: count() })
        .from(waitlistUsers)
        .where(eq(waitlistUsers.status, "confirmed")),

      // Pending users
      db
        .select({ count: count() })
        .from(waitlistUsers)
        .where(eq(waitlistUsers.status, "pending")),

      // Users grouped by tier
      db
        .select({
          tier: waitlistUsers.tier,
          count: count(),
        })
        .from(waitlistUsers)
        .groupBy(waitlistUsers.tier),

      // Users with profile completed
      db
        .select({ count: count() })
        .from(waitlistUsers)
        .where(isNotNull(waitlistUsers.profileCompletedAt)),

      // Total referrals
      db.select({ count: count() }).from(waitlistReferrals),
    ]);

  const total = totalResult[0]?.count ?? 0;
  const profileCompleted = profileCompletedResult[0]?.count ?? 0;

  return {
    total,
    confirmed: confirmedResult[0]?.count ?? 0,
    pending: pendingResult[0]?.count ?? 0,
    byTier: byTierResult.map((row) => ({
      tier: row.tier,
      count: row.count,
    })),
    profileCompletionRate: total > 0 ? Math.round((profileCompleted / total) * 100) : 0,
    referralCount: referralCountResult[0]?.count ?? 0,
  };
};

/**
 * Get analytics distributions for waitlist users.
 */
export const getAdminWaitlistAnalytics = async (): Promise<AdminWaitlistAnalytics> => {
  const [
    roleResult,
    aiStackResult,
    vibeToolResult,
    monthlySpendResult,
    featuresResult,
    signupsPerDayResult,
  ] = await Promise.all([
    // Role distribution
    db
      .select({
        role: waitlistUsers.profileRole,
        count: count(),
      })
      .from(waitlistUsers)
      .where(isNotNull(waitlistUsers.profileRole))
      .groupBy(waitlistUsers.profileRole)
      .orderBy(sql`count(*) desc`),

    // AI Stack distribution (unnest JSONB array)
    db.execute(sql<{ ai_stack: string; count: number }>`
      SELECT ai_stack, COUNT(*)::int as count
      FROM (
        SELECT jsonb_array_elements_text(profile_ai_stack) as ai_stack
        FROM ${waitlistUsers}
        WHERE profile_ai_stack IS NOT NULL
        AND jsonb_array_length(profile_ai_stack) > 0
      ) sub
      GROUP BY ai_stack
      ORDER BY count DESC
    `),

    // Vibe Tool distribution (unnest JSONB array)
    db.execute(sql<{ vibe_tool: string; count: number }>`
      SELECT vibe_tool, COUNT(*)::int as count
      FROM (
        SELECT jsonb_array_elements_text(profile_vibe_tool) as vibe_tool
        FROM ${waitlistUsers}
        WHERE profile_vibe_tool IS NOT NULL
        AND jsonb_array_length(profile_vibe_tool) > 0
      ) sub
      GROUP BY vibe_tool
      ORDER BY count DESC
    `),

    // Monthly Spend distribution
    db
      .select({
        monthlySpend: waitlistUsers.profileMonthlySpend,
        count: count(),
      })
      .from(waitlistUsers)
      .where(isNotNull(waitlistUsers.profileMonthlySpend))
      .groupBy(waitlistUsers.profileMonthlySpend)
      .orderBy(sql`count(*) desc`),

    // Feature interests (unnest JSONB array)
    db.execute(sql<{
      feature: string;
      count: number;
    }>`
      SELECT
        feature,
        COUNT(*)::int as count
      FROM (
        SELECT jsonb_array_elements_text(profile_features) as feature
        FROM ${waitlistUsers}
        WHERE profile_features IS NOT NULL
        AND jsonb_array_length(profile_features) > 0
      ) sub
      GROUP BY feature
      ORDER BY count DESC
    `),

    // Signups per day (last 30 days)
    db.execute(sql<{
      date: string;
      count: number;
    }>`
      SELECT
        DATE(created_at) as date,
        COUNT(*)::int as count
      FROM ${waitlistUsers}
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `),
  ]);

  return {
    roleDistribution: roleResult.map((row) => ({
      label: row.role ?? "Unknown",
      value: row.count,
    })),
    aiStackDistribution: (aiStackResult as unknown as { ai_stack: string; count: number }[]).map((row) => ({
      label: row.ai_stack ?? "Unknown",
      value: Number(row.count),
    })),
    vibeToolDistribution: (vibeToolResult as unknown as { vibe_tool: string; count: number }[]).map((row) => ({
      label: row.vibe_tool ?? "Unknown",
      value: Number(row.count),
    })),
    monthlySpendDistribution: monthlySpendResult.map((row) => ({
      label: row.monthlySpend ?? "Unknown",
      value: Number(row.count),
    })),
    featureInterestCounts: (featuresResult as unknown as { feature: string; count: number }[]).map((row) => ({
      label: row.feature,
      value: Number(row.count),
    })),
    signupsPerDay: (signupsPerDayResult as unknown as { date: string; count: number }[]).map((row) => ({
      date: row.date,
      count: Number(row.count),
    })),
  };
};

// ---------------------------------------------------------------------------
// Thank-You Send Repository Functions
// ---------------------------------------------------------------------------

/**
 * Get all thank-you sends for a given waitlist user.
 */
export const getThankYouSendsByUserId = async (
  userId: string
): Promise<WaitlistThankYouSend[]> => {
  return db
    .select()
    .from(waitlistThankYouSends)
    .where(eq(waitlistThankYouSends.userId, userId))
    .orderBy(desc(waitlistThankYouSends.sentAt));
};

/**
 * Insert a thank-you send record. Throws on duplicate (user + tier).
 */
export const insertThankYouSend = async (args: {
  userId: string;
  tier: string;
  sentByUserId: string;
  resendEmailId?: string;
}): Promise<WaitlistThankYouSend> => {
  const [created] = await db
    .insert(waitlistThankYouSends)
    .values({
      userId: args.userId,
      tier: args.tier as typeof waitlistThankYouSends.tier.enumValues[number],
      sentByUserId: args.sentByUserId,
      resendEmailId: args.resendEmailId ?? null,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to insert thank-you send record");
  }

  return created;
};

/**
 * Check whether a thank-you email has already been sent for a user + tier.
 */
export const hasThankYouBeenSent = async (
  userId: string,
  tier: string
): Promise<boolean> => {
  const [row] = await db
    .select({ id: waitlistThankYouSends.id })
    .from(waitlistThankYouSends)
    .where(
      and(
        eq(waitlistThankYouSends.userId, userId),
        eq(waitlistThankYouSends.tier, tier as typeof waitlistThankYouSends.tier.enumValues[number])
      )
    )
    .limit(1);

  return !!row;
};

/**
 * Update delivery status of a thank-you send by Resend email ID.
 * Returns true if a record was updated.
 */
export const updateThankYouDeliveryStatus = async (
  resendEmailId: string,
  deliveryStatus: "sent" | "delivered" | "bounced" | "complained"
): Promise<boolean> => {
  const result = await db
    .update(waitlistThankYouSends)
    .set({
      deliveryStatus,
      deliveryStatusUpdatedAt: new Date(),
    })
    .where(eq(waitlistThankYouSends.resendEmailId, resendEmailId))
    .returning({ id: waitlistThankYouSends.id });

  return result.length > 0;
};

/**
 * Get all thank-you sends with status "sent" that have a Resend email ID.
 * Used for backfilling delivery status from the Resend API.
 */
export const getPendingThankYouSends = async (): Promise<
  { id: string; resendEmailId: string }[]
> => {
  return db
    .select({
      id: waitlistThankYouSends.id,
      resendEmailId: waitlistThankYouSends.resendEmailId,
    })
    .from(waitlistThankYouSends)
    .where(
      and(
        eq(waitlistThankYouSends.deliveryStatus, "sent"),
        isNotNull(waitlistThankYouSends.resendEmailId)
      )
    ) as Promise<{ id: string; resendEmailId: string }[]>;
};
