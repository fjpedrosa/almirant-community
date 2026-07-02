import { db } from "../../client";
import { expenseCategories } from "../../schema";
import { and, asc, eq } from "drizzle-orm";

type ExpenseCategory = typeof expenseCategories.$inferSelect;

export interface CreateExpenseCategoryRequest {
  name: string;
  icon?: string | null;
  color?: string | null;
  order?: number;
  parentId?: string | null;
}

export interface UpdateExpenseCategoryRequest {
  name?: string;
  icon?: string | null;
  color?: string | null;
  order?: number;
  parentId?: string | null;
  isActive?: boolean;
}

export const getExpenseCategories = async (workspaceId: string): Promise<ExpenseCategory[]> => {
  return db
    .select()
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.workspaceId, workspaceId),
        eq(expenseCategories.isActive, true)
      )
    )
    .orderBy(asc(expenseCategories.order), asc(expenseCategories.name));
};

export const getExpenseCategoryById = async (
  workspaceId: string,
  id: string
): Promise<ExpenseCategory | null> => {
  const [category] = await db
    .select()
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.id, id),
        eq(expenseCategories.workspaceId, workspaceId)
      )
    )
    .limit(1);

  return category ?? null;
};

export const createExpenseCategory = async (
  workspaceId: string,
  data: CreateExpenseCategoryRequest
): Promise<ExpenseCategory> => {
  const [created] = await db
    .insert(expenseCategories)
    .values({
      workspaceId,
      name: data.name.trim(),
      icon: data.icon ?? null,
      color: data.color ?? null,
      order: data.order ?? 0,
      parentId: data.parentId ?? null,
    })
    .returning();

  if (!created) {
    throw new Error("FAILED_TO_CREATE_EXPENSE_CATEGORY");
  }

  return created;
};

export const updateExpenseCategory = async (
  workspaceId: string,
  id: string,
  data: UpdateExpenseCategoryRequest
): Promise<ExpenseCategory | null> => {
  const updateValues: Partial<typeof expenseCategories.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) updateValues.name = data.name.trim();
  if (data.icon !== undefined) updateValues.icon = data.icon;
  if (data.color !== undefined) updateValues.color = data.color;
  if (data.order !== undefined) updateValues.order = data.order;
  if (data.parentId !== undefined) updateValues.parentId = data.parentId;
  if (data.isActive !== undefined) updateValues.isActive = data.isActive;

  const [updated] = await db
    .update(expenseCategories)
    .set(updateValues)
    .where(
      and(
        eq(expenseCategories.id, id),
        eq(expenseCategories.workspaceId, workspaceId)
      )
    )
    .returning();

  return updated ?? null;
};

export const deleteExpenseCategory = async (
  workspaceId: string,
  id: string
): Promise<boolean> => {
  const deleted = await db
    .delete(expenseCategories)
    .where(
      and(
        eq(expenseCategories.id, id),
        eq(expenseCategories.workspaceId, workspaceId)
      )
    )
    .returning({ id: expenseCategories.id });

  return deleted.length > 0;
};
