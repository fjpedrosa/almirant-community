import { Elysia } from "elysia";
import {
  getTags,
  getTagById,
  createTag,
  updateTag,
  deleteTag,
} from "@almirant/database";
import { crudRoutes } from "./routes/crud.routes";
import { createTagUseCases } from "./use-cases/crud.use-cases";
import type { TagRepository } from "./ports";

// Wire repository implementation to port
const repo: TagRepository = {
  getAll: getTags,
  getById: getTagById,
  create: createTag,
  update: updateTag,
  delete: deleteTag,
};

const useCases = createTagUseCases({ repo });

export const tagsModule = () =>
  new Elysia({ prefix: "/tags" }).use(crudRoutes(useCases));
