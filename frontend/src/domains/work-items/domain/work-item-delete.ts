import type { WorkItemType } from "./types";

export type DeletableWorkItem = {
  type: WorkItemType;
  childrenCount: number;
};

export const canDeleteWorkItem = ({ type, childrenCount }: DeletableWorkItem): boolean =>
  type === "task" && childrenCount === 0;
