import { db } from "../../client";
import { recurringExpenses } from "../../schema";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";

type RecurringExpense = typeof recurringExpenses.$inferSelect;

export interface RecurringExpenseFilters {
  isActive?: boolean;
}

export interface CreateRecurringExpenseRequest {
  title: string;
  vendor?: string | null;
  amount: string;
  currency: string;
  recurrence: string;
  anchorDate: string | Date;
  nextRenewalDate?: string | Date | null;
  alertDaysBefore?: number;
  categoryId?: string | null;
  paidByUserId?: string | null;
  projectId?: string | null;
}

export type UpdateRecurringExpenseRequest = Partial<CreateRecurringExpenseRequest> & {
  isActive?: boolean;
  cancelledAt?: Date | null;
};

export const getRecurringExpenses = async (
  workspaceId: string,
  filters?: RecurringExpenseFilters
): Promise<RecurringExpense[]> => {
  const conditions = [eq(recurringExpenses.workspaceId, workspaceId)];

  if (filters?.isActive !== undefined) {
    conditions.push(eq(recurringExpenses.isActive, filters.isActive));
  }

  return db
    .select()
    .from(recurringExpenses)
    .where(and(...conditions))
    .orderBy(
      sql`${recurringExpenses.nextRenewalDate} ASC NULLS LAST`,
      desc(recurringExpenses.createdAt)
    );
};

export const getRecurringExpenseById = async (
  workspaceId: string,
  id: string
): Promise<RecurringExpense | null> => {
  const [item] = await db
    .select()
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.id, id),
        eq(recurringExpenses.workspaceId, workspaceId)
      )
    )
    .limit(1);

  return item ?? null;
};

export const createRecurringExpense = async (
  workspaceId: string,
  data: CreateRecurringExpenseRequest
): Promise<RecurringExpense> => {
  const [created] = await db
    .insert(recurringExpenses)
    .values({
      workspaceId,
      title: data.title.trim(),
      vendor: data.vendor ?? null,
      amount: data.amount,
      currency: data.currency as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS",
      recurrence: data.recurrence as "weekly" | "monthly" | "quarterly" | "yearly",
      anchorDate:
        data.anchorDate instanceof Date ? data.anchorDate : new Date(data.anchorDate),
      nextRenewalDate: data.nextRenewalDate
        ? data.nextRenewalDate instanceof Date
          ? data.nextRenewalDate
          : new Date(data.nextRenewalDate)
        : null,
      alertDaysBefore: data.alertDaysBefore ?? 7,
      categoryId: data.categoryId ?? null,
      paidByUserId: data.paidByUserId ?? null,
      projectId: data.projectId ?? null,
    })
    .returning();

  if (!created) {
    throw new Error("FAILED_TO_CREATE_RECURRING_EXPENSE");
  }

  return created;
};

export const updateRecurringExpense = async (
  workspaceId: string,
  id: string,
  data: UpdateRecurringExpenseRequest
): Promise<RecurringExpense | null> => {
  const updateValues: Partial<typeof recurringExpenses.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.title !== undefined) updateValues.title = data.title.trim();
  if (data.vendor !== undefined) updateValues.vendor = data.vendor;
  if (data.amount !== undefined) updateValues.amount = data.amount;
  if (data.currency !== undefined)
    updateValues.currency = data.currency as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS";
  if (data.recurrence !== undefined)
    updateValues.recurrence = data.recurrence as "weekly" | "monthly" | "quarterly" | "yearly";
  if (data.anchorDate !== undefined) {
    updateValues.anchorDate =
      data.anchorDate instanceof Date ? data.anchorDate : new Date(data.anchorDate);
  }
  if (data.nextRenewalDate !== undefined) {
    updateValues.nextRenewalDate = data.nextRenewalDate
      ? data.nextRenewalDate instanceof Date
        ? data.nextRenewalDate
        : new Date(data.nextRenewalDate)
      : null;
  }
  if (data.alertDaysBefore !== undefined) updateValues.alertDaysBefore = data.alertDaysBefore;
  if (data.categoryId !== undefined) updateValues.categoryId = data.categoryId;
  if (data.paidByUserId !== undefined) updateValues.paidByUserId = data.paidByUserId;
  if (data.projectId !== undefined) updateValues.projectId = data.projectId;
  if (data.isActive !== undefined) updateValues.isActive = data.isActive;
  if (data.cancelledAt !== undefined) updateValues.cancelledAt = data.cancelledAt;

  const [updated] = await db
    .update(recurringExpenses)
    .set(updateValues)
    .where(
      and(
        eq(recurringExpenses.id, id),
        eq(recurringExpenses.workspaceId, workspaceId)
      )
    )
    .returning();

  return updated ?? null;
};

export const deleteRecurringExpense = async (
  workspaceId: string,
  id: string
): Promise<boolean> => {
  const deleted = await db
    .delete(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.id, id),
        eq(recurringExpenses.workspaceId, workspaceId)
      )
    )
    .returning({ id: recurringExpenses.id });

  return deleted.length > 0;
};

export const getUpcomingRenewals = async (
  workspaceId: string,
  daysAhead = 30
): Promise<RecurringExpense[]> => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);

  return db
    .select()
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.workspaceId, workspaceId),
        eq(recurringExpenses.isActive, true),
        lte(recurringExpenses.nextRenewalDate, cutoff)
      )
    )
    .orderBy(asc(recurringExpenses.nextRenewalDate));
};

export const getRecurringSummary = async (
  workspaceId: string
): Promise<{ totalMonthlyAmount: string; activeCount: number }> => {
  const active = await db
    .select()
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.workspaceId, workspaceId),
        eq(recurringExpenses.isActive, true)
      )
    );

  let totalMonthly = 0;
  for (const r of active) {
    const amount = parseFloat(r.amount);
    let monthly = amount;
    if (r.recurrence === "weekly") monthly = amount * 4.33;
    else if (r.recurrence === "quarterly") monthly = amount / 3;
    else if (r.recurrence === "yearly") monthly = amount / 12;
    totalMonthly += monthly;
  }

  return {
    totalMonthlyAmount: totalMonthly.toFixed(2),
    activeCount: active.length,
  };
};
