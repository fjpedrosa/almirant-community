import { Elysia } from "elysia";
import {
  getSavedViewsByBoard,
  getSavedViewById,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  getBoardById,
  getViewPreference,
  upsertViewPreference,
} from "@almirant/database";
import { boardViewRoutes, userPreferenceRoutes } from "./routes/crud.routes";
import { createSavedViewUseCases } from "./use-cases/crud.use-cases";
import type { SavedViewRepository, BoardRepository, ViewPreferenceRepository } from "./ports";

// Wire repository implementations to ports
const repo: SavedViewRepository = {
  getByBoard: getSavedViewsByBoard,
  getById: getSavedViewById,
  create: createSavedView,
  update: updateSavedView,
  delete: deleteSavedView,
};

const boardRepo: BoardRepository = {
  getById: getBoardById,
};

const prefRepo: ViewPreferenceRepository = {
  get: getViewPreference,
  upsert: upsertViewPreference,
};

const useCases = createSavedViewUseCases({ repo, boardRepo, prefRepo });

// Board saved views (org-scoped, mounted under /api with requireOrganization)
export const savedViewsModule = () =>
  new Elysia().use(boardViewRoutes(useCases));

// User view preferences (auth-only, mounted under /api before requireOrganization)
export const userViewPreferencesModule = () =>
  new Elysia().use(userPreferenceRoutes(useCases));
