import { Elysia } from "elysia";
import {
  getDocumentCategories,
  getDocumentCategoryById,
  createDocumentCategory,
  updateDocumentCategory,
  deleteDocumentCategory,
} from "@almirant/database";
import { crudRoutes } from "./routes/crud.routes";
import { createDocumentCategoryUseCases } from "./use-cases/crud.use-cases";
import type { DocumentCategoryRepository } from "./ports";

// Wire repository implementation to port
const repo: DocumentCategoryRepository = {
  getAll: getDocumentCategories,
  getById: getDocumentCategoryById,
  create: createDocumentCategory,
  update: updateDocumentCategory,
  delete: deleteDocumentCategory,
};

const useCases = createDocumentCategoryUseCases({ repo });

export const documentCategoriesModule = () =>
  new Elysia({ prefix: "/document-categories" }).use(crudRoutes(useCases));
