import type {
  MilestoneWithProgress,
  MilestoneDetail,
  CreateMilestoneInput,
  UpdateMilestoneInput,
} from "@almirant/database";

export type MilestoneRepository = {
  getByProject: (orgId: string, projectId: string) => Promise<MilestoneWithProgress[]>;
  getById: (orgId: string, id: string) => Promise<MilestoneDetail | null>;
  create: (orgId: string, data: CreateMilestoneInput) => Promise<MilestoneWithProgress | null>;
  update: (orgId: string, id: string, data: UpdateMilestoneInput) => Promise<MilestoneWithProgress | null>;
  delete: (orgId: string, id: string) => Promise<boolean>;
  addWorkItems: (milestoneId: string, workItemIds: string[]) => Promise<number>;
  removeWorkItem: (milestoneId: string, workItemId: string) => Promise<boolean>;
};
