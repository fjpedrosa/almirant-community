import { Elysia } from "elysia";
import {
  getMilestonesByProject,
  getMilestoneById,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  addWorkItemsToMilestone,
  removeWorkItemFromMilestone,
} from "@almirant/database";
import { crudRoutes } from "./routes/crud.routes";
import { createMilestoneUseCases } from "./use-cases/crud.use-cases";
import type { MilestoneRepository } from "./ports";

// Wire repository implementation to port
const repo: MilestoneRepository = {
  getByProject: getMilestonesByProject,
  getById: getMilestoneById,
  create: createMilestone,
  update: updateMilestone,
  delete: deleteMilestone,
  addWorkItems: addWorkItemsToMilestone,
  removeWorkItem: removeWorkItemFromMilestone,
};

const useCases = createMilestoneUseCases({ repo });

export const milestonesModule = () =>
  new Elysia({ prefix: "/milestones" }).use(crudRoutes(useCases));
