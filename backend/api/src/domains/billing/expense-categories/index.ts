import { Elysia } from "elysia";
import {
  getExpenseCategories,
  getExpenseCategoryById,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
} from "@almirant/database";
import { crudRoutes } from "./routes/crud.routes";
import { createExpenseCategoryUseCases } from "./use-cases/crud.use-cases";
import type { ExpenseCategoryRepository } from "./ports";

// Wire repository implementation to port
const repo: ExpenseCategoryRepository = {
  getAll: getExpenseCategories,
  getById: getExpenseCategoryById,
  create: createExpenseCategory,
  update: updateExpenseCategory,
  delete: deleteExpenseCategory,
};

const useCases = createExpenseCategoryUseCases({ repo });

export const expenseCategoriesModule = () =>
  new Elysia({ prefix: "/expense-categories" }).use(crudRoutes(useCases));
