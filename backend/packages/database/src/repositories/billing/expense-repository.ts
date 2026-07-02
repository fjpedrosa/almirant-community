import { db } from "../../client";
import { expenses, expenseCategories, expenseTags, tags, user } from "../../schema";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { PaginationParams } from "../../domain/types";

// ── Types ──────────────────────────────────────────────────────────────

export interface ExpenseFilters {
  status?: string;
  currency?: string;
  categoryId?: string;
  paidByUserId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateExpenseRequest {
  title: string;
  description?: string | null;
  vendor?: string | null;
  amount: string;
  currency: string;
  amountEur?: string | null;
  exchangeRate?: string | null;
  categoryId?: string | null;
  paidByUserId?: string | null;
  expenseDate: string | Date;
  status?: string;
  projectId?: string | null;
  recurringExpenseId?: string | null;
}

export interface UpdateExpenseRequest extends Partial<CreateExpenseRequest> {
  invoiceFileName?: string | null;
  invoiceFileUrl?: string | null;
  invoiceFileSize?: number | null;
  invoiceMimeType?: string | null;
  invoiceProcessingStatus?: string | null;
  invoiceProcessedData?: Record<string, unknown> | null;
  archivedAt?: Date | null;
}

export interface ExpenseRelations {
  category: { id: string; name: string; icon: string | null; color: string | null } | null;
  paidByUser: { id: string; name: string; email: string; image: string | null } | null;
  tags: { id: string; name: string; color: string | null }[];
}

export type ExpenseWithRelations = typeof expenses.$inferSelect & ExpenseRelations;

// ── Helpers ─────────────────────────────────────────────────────────────

type ExpenseRow = typeof expenses.$inferSelect;

const hydrateExpenseRelations = async (item: ExpenseRow): Promise<ExpenseWithRelations> => {
  const [categoryResult, paidByUserResult, tagsResult] = await Promise.all([
    item.categoryId
      ? db
          .select({
            id: expenseCategories.id,
            name: expenseCategories.name,
            icon: expenseCategories.icon,
            color: expenseCategories.color,
          })
          .from(expenseCategories)
          .where(eq(expenseCategories.id, item.categoryId))
          .limit(1)
      : Promise.resolve([]),
    item.paidByUserId
      ? db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          })
          .from(user)
          .where(eq(user.id, item.paidByUserId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(expenseTags)
      .innerJoin(tags, eq(expenseTags.tagId, tags.id))
      .where(eq(expenseTags.expenseId, item.id)),
  ]);

  return {
    ...item,
    category: categoryResult[0] ?? null,
    paidByUser: paidByUserResult[0] ?? null,
    tags: tagsResult,
  };
};

// ── CRUD ────────────────────────────────────────────────────────────────

export const getExpenses = async (
  workspaceId: string,
  pagination: PaginationParams,
  filters?: ExpenseFilters
): Promise<{ items: ExpenseWithRelations[]; total: number }> => {
  const conditions = [eq(expenses.workspaceId, workspaceId)];

  if (filters?.status) {
    conditions.push(eq(expenses.status, filters.status as "draft" | "pending_approval" | "approved" | "rejected" | "paid" | "void"));
  }

  if (filters?.currency) {
    conditions.push(eq(expenses.currency, filters.currency as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS"));
  }

  if (filters?.categoryId) {
    conditions.push(eq(expenses.categoryId, filters.categoryId));
  }

  if (filters?.paidByUserId) {
    conditions.push(eq(expenses.paidByUserId, filters.paidByUserId));
  }

  if (filters?.search) {
    conditions.push(
      or(
        ilike(expenses.title, `%${filters.search}%`),
        ilike(expenses.vendor, `%${filters.search}%`)
      )!
    );
  }

  if (filters?.dateFrom) {
    conditions.push(gte(expenses.expenseDate, new Date(filters.dateFrom)));
  }

  if (filters?.dateTo) {
    conditions.push(lte(expenses.expenseDate, new Date(filters.dateTo)));
  }

  const whereClause = and(...conditions);

  const [itemsResult, countResult] = await Promise.all([
    db
      .select()
      .from(expenses)
      .where(whereClause)
      .orderBy(desc(expenses.expenseDate))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(expenses)
      .where(whereClause),
  ]);

  const itemsWithRelations = await Promise.all(
    itemsResult.map((item) => hydrateExpenseRelations(item))
  );

  return {
    items: itemsWithRelations,
    total: countResult[0]?.count ?? 0,
  };
};

export const getExpenseById = async (
  workspaceId: string,
  id: string
): Promise<ExpenseWithRelations | null> => {
  const [item] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId)))
    .limit(1);

  if (!item) return null;
  return hydrateExpenseRelations(item);
};

export const createExpense = async (
  workspaceId: string,
  data: CreateExpenseRequest,
  createdByUserId?: string
): Promise<ExpenseWithRelations> => {
  const [created] = await db
    .insert(expenses)
    .values({
      workspaceId,
      title: data.title.trim(),
      description: data.description ?? null,
      vendor: data.vendor ?? null,
      amount: data.amount,
      currency: (data.currency as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS") ?? "EUR",
      amountEur: data.amountEur ?? null,
      exchangeRate: data.exchangeRate ?? null,
      categoryId: data.categoryId ?? null,
      paidByUserId: data.paidByUserId ?? null,
      expenseDate: data.expenseDate instanceof Date ? data.expenseDate : new Date(data.expenseDate),
      status: (data.status as "draft" | "pending_approval" | "approved" | "rejected" | "paid" | "void") ?? "draft",
      projectId: data.projectId ?? null,
      recurringExpenseId: data.recurringExpenseId ?? null,
    })
    .returning();

  if (!created) {
    throw new Error("FAILED_TO_CREATE_EXPENSE");
  }

  return hydrateExpenseRelations(created);
};

export const updateExpense = async (
  workspaceId: string,
  id: string,
  data: UpdateExpenseRequest
): Promise<ExpenseWithRelations | null> => {
  const updateValues: Partial<typeof expenses.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.title !== undefined) updateValues.title = data.title.trim();
  if (data.description !== undefined) updateValues.description = data.description;
  if (data.vendor !== undefined) updateValues.vendor = data.vendor;
  if (data.amount !== undefined) updateValues.amount = data.amount;
  if (data.currency !== undefined) updateValues.currency = data.currency as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS";
  if (data.amountEur !== undefined) updateValues.amountEur = data.amountEur;
  if (data.exchangeRate !== undefined) updateValues.exchangeRate = data.exchangeRate;
  if (data.categoryId !== undefined) updateValues.categoryId = data.categoryId;
  if (data.paidByUserId !== undefined) updateValues.paidByUserId = data.paidByUserId;
  if (data.expenseDate !== undefined) {
    updateValues.expenseDate = data.expenseDate instanceof Date ? data.expenseDate : new Date(data.expenseDate);
  }
  if (data.status !== undefined) updateValues.status = data.status as "draft" | "pending_approval" | "approved" | "rejected" | "paid" | "void";
  if (data.projectId !== undefined) updateValues.projectId = data.projectId;
  if (data.recurringExpenseId !== undefined) updateValues.recurringExpenseId = data.recurringExpenseId;
  if (data.invoiceFileName !== undefined) updateValues.invoiceFileName = data.invoiceFileName;
  if (data.invoiceFileUrl !== undefined) updateValues.invoiceFileUrl = data.invoiceFileUrl;
  if (data.invoiceFileSize !== undefined) updateValues.invoiceFileSize = data.invoiceFileSize;
  if (data.invoiceMimeType !== undefined) updateValues.invoiceMimeType = data.invoiceMimeType;
  if (data.invoiceProcessingStatus !== undefined) updateValues.invoiceProcessingStatus = data.invoiceProcessingStatus as "pending" | "processing" | "processed" | "failed" | null;
  if (data.invoiceProcessedData !== undefined) updateValues.invoiceProcessedData = data.invoiceProcessedData ?? undefined;
  if (data.archivedAt !== undefined) updateValues.archivedAt = data.archivedAt;

  const [updated] = await db
    .update(expenses)
    .set(updateValues)
    .where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId)))
    .returning();

  if (!updated) return null;
  return hydrateExpenseRelations(updated);
};

export const deleteExpense = async (
  workspaceId: string,
  id: string
): Promise<boolean> => {
  const deleted = await db
    .delete(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId)))
    .returning({ id: expenses.id });

  return deleted.length > 0;
};

// ── Aggregations ─────────────────────────────────────────────────────────

export interface ExpenseAggregations {
  totalAmount: string;
  byPerson: { userId: string; name: string | null; image: string | null; total: string }[];
  byCategory: { categoryId: string | null; name: string | null; color: string | null; total: string }[];
  byMonth: { month: string; total: string }[];
  recentExpenses: ExpenseWithRelations[];
}

export const getExpenseAggregations = async (
  workspaceId: string,
  filters?: ExpenseFilters
): Promise<ExpenseAggregations> => {
  const conditions = [eq(expenses.workspaceId, workspaceId)];

  if (filters?.status) {
    conditions.push(eq(expenses.status, filters.status as "draft" | "pending_approval" | "approved" | "rejected" | "paid" | "void"));
  }
  if (filters?.currency) {
    conditions.push(eq(expenses.currency, filters.currency as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS"));
  }
  if (filters?.categoryId) {
    conditions.push(eq(expenses.categoryId, filters.categoryId));
  }
  if (filters?.paidByUserId) {
    conditions.push(eq(expenses.paidByUserId, filters.paidByUserId));
  }
  if (filters?.search) {
    conditions.push(
      or(
        ilike(expenses.title, `%${filters.search}%`),
        ilike(expenses.vendor, `%${filters.search}%`)
      )!
    );
  }
  if (filters?.dateFrom) {
    conditions.push(gte(expenses.expenseDate, new Date(filters.dateFrom)));
  }
  if (filters?.dateTo) {
    conditions.push(lte(expenses.expenseDate, new Date(filters.dateTo)));
  }

  const whereClause = and(...conditions);

  const [totalResult, byPersonResult, byCategoryResult, byMonthResult, recentResult] =
    await Promise.all([
      // Total amount
      db
        .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)::text` })
        .from(expenses)
        .where(whereClause),
      // By person
      db
        .select({
          userId: expenses.paidByUserId,
          name: user.name,
          image: user.image,
          total: sql<string>`sum(${expenses.amount})::text`,
        })
        .from(expenses)
        .leftJoin(user, eq(expenses.paidByUserId, user.id))
        .where(whereClause)
        .groupBy(expenses.paidByUserId, user.name, user.image),
      // By category
      db
        .select({
          categoryId: expenses.categoryId,
          name: expenseCategories.name,
          color: expenseCategories.color,
          total: sql<string>`sum(${expenses.amount})::text`,
        })
        .from(expenses)
        .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
        .where(whereClause)
        .groupBy(expenses.categoryId, expenseCategories.name, expenseCategories.color),
      // By month
      db
        .select({
          month: sql<string>`date_trunc('month', ${expenses.expenseDate})::text`,
          total: sql<string>`sum(${expenses.amount})::text`,
        })
        .from(expenses)
        .where(whereClause)
        .groupBy(sql`date_trunc('month', ${expenses.expenseDate})`)
        .orderBy(sql`date_trunc('month', ${expenses.expenseDate}) ASC`),
      // Recent expenses (last 5)
      db
        .select()
        .from(expenses)
        .where(whereClause)
        .orderBy(desc(expenses.expenseDate))
        .limit(5),
    ]);

  const recentWithRelations = await Promise.all(
    recentResult.map((item) => hydrateExpenseRelations(item))
  );

  return {
    totalAmount: totalResult[0]?.total ?? "0",
    byPerson: byPersonResult.map((r) => ({
      userId: r.userId ?? "",
      name: r.name ?? null,
      image: r.image ?? null,
      total: r.total ?? "0",
    })),
    byCategory: byCategoryResult.map((r) => ({
      categoryId: r.categoryId ?? null,
      name: r.name ?? null,
      color: r.color ?? null,
      total: r.total ?? "0",
    })),
    byMonth: byMonthResult.map((r) => ({
      month: r.month ?? "",
      total: r.total ?? "0",
    })),
    recentExpenses: recentWithRelations,
  };
};
