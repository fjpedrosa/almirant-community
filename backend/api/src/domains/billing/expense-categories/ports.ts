import type {
  ExpenseCategory,
  CreateExpenseCategoryRequest,
  UpdateExpenseCategoryRequest,
} from "@almirant/database";

export type ExpenseCategoryRepository = {
  getAll: (orgId: string) => Promise<ExpenseCategory[]>;
  getById: (orgId: string, id: string) => Promise<ExpenseCategory | null>;
  create: (orgId: string, data: CreateExpenseCategoryRequest) => Promise<ExpenseCategory>;
  update: (orgId: string, id: string, data: UpdateExpenseCategoryRequest) => Promise<ExpenseCategory | null>;
  delete: (orgId: string, id: string) => Promise<boolean>;
};
