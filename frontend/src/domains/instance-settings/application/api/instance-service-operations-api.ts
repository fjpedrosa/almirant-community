import { request } from "@/lib/api/client";
import type {
  ControllableInstanceService,
  InstanceServiceOperationsStatus,
  ServiceOperationJob,
  StartServiceOperationResponse,
} from "../../domain/types";

export const instanceServiceOperationsApi = {
  getStatus: () =>
    request<InstanceServiceOperationsStatus>("/instance/services/status"),

  restartService: (
    service: ControllableInstanceService,
    options?: { force?: boolean },
  ) =>
    request<StartServiceOperationResponse>(
      `/instance/services/${encodeURIComponent(service)}/restart`,
      {
        method: "POST",
        body: JSON.stringify({ force: options?.force ?? false }),
      },
    ),

  cleanupExitedContainers: () =>
    request<StartServiceOperationResponse>(
      "/instance/services/agent-containers/cleanup-exited",
      { method: "POST" },
    ),

  getOperationJob: (jobId: string) =>
    request<ServiceOperationJob>(
      `/instance/service-operations/${encodeURIComponent(jobId)}`,
    ),
};
