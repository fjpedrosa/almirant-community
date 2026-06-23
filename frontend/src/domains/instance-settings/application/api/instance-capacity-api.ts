import { request } from "@/lib/api/client";
import type { InstanceCapacityDiagnostics } from "../../domain/types";

export const instanceCapacityApi = {
  get: () => request<InstanceCapacityDiagnostics>("/instance/capacity"),
  cancelOrphanedJob: (jobId: string) =>
    request<unknown>(`/agent-jobs/${jobId}/cancel`, { method: "POST" }),
};
