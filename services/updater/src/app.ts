import { Elysia, t } from "elysia";
import type { JobRunner, JobEvent } from "./job-runner";
import type { InfraRunner, InfraJobEvent } from "./infra-runner";
import type {
  ServiceOpsRunner,
  ServiceOperationEvent,
} from "./service-ops-runner";
import { isControllableService } from "./service-ops";

export interface AppDeps {
  runner: JobRunner;
  infraRunner: InfraRunner;
  serviceOpsRunner: ServiceOpsRunner;
  token: string;
}

const sseStreamForJob = (
  getJob: (id: string) => { logTail: unknown[]; status: string; step: string | null } | null,
  subscribe: (
    id: string,
    fn: (event: JobEvent | InfraJobEvent | ServiceOperationEvent) => void,
  ) => (() => void) | null,
  jobId: string,
): Response => {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const send = (
        event: JobEvent | InfraJobEvent | ServiceOperationEvent,
      ): void => {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // controller closed — subscriber will be removed on cancel
        }
      };

      const snapshot = getJob(jobId);
      if (!snapshot) {
        controller.close();
        return;
      }

      for (const line of snapshot.logTail) {
        send({
          type: "log",
          line,
        } as JobEvent | InfraJobEvent | ServiceOperationEvent);
      }
      send({
        type: "status",
        status: snapshot.status,
        step: snapshot.step,
      } as JobEvent | InfraJobEvent | ServiceOperationEvent);

      if (snapshot.status === "success" || snapshot.status === "failed") {
        controller.close();
        return;
      }

      unsubscribe = subscribe(jobId, (event) => {
        send(event);
        if (
          event.type === "status" &&
          (event.status === "success" || event.status === "failed")
        ) {
          unsubscribe?.();
          unsubscribe = null;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });

      if (!unsubscribe) {
        controller.close();
      }
    },
    cancel: () => {
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
};

export const createApp = ({
  runner,
  infraRunner,
  serviceOpsRunner,
  token,
}: AppDeps) => {
  const requireToken = new Elysia({ name: "require-updater-token" })
    .onBeforeHandle({ as: "scoped" }, ({ request, set }) => {
      const provided = request.headers.get("x-updater-token");
      if (provided !== token) {
        set.status = 401;
        return { error: "unauthorized" };
      }
    });

  const publicRoutes = new Elysia().get("/health", () => ({
    ok: true,
    service: "updater",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  const protectedRoutes = new Elysia()
    .use(requireToken)
    .get("/jobs/active", () => ({ job: runner.getActive() }))
    .post("/jobs", async ({ set }) => {
      const result = await runner.start();
      if (!result.ok) {
        set.status = 409;
        return { error: "active_job_exists", activeJob: result.activeJob };
      }
      set.status = 202;
      return {
        jobId: result.job.id,
        startedAt: result.job.startedAt,
        fromSha: result.job.fromSha,
      };
    })
    .get("/jobs/:id", ({ params, set }) => {
      const job = runner.getJob(params.id);
      if (!job) {
        set.status = 404;
        return { error: "not_found" };
      }
      return job;
    })
    .get("/jobs/:id/stream", ({ params }) =>
      sseStreamForJob(
        (id) => runner.getJob(id),
        (id, fn) => runner.subscribe(id, fn as (event: JobEvent) => void),
        params.id,
      ),
    )
    .get("/infra/jobs/active", () => ({ job: infraRunner.getActive() }))
    .get("/infra/jobs/:id", ({ params, set }) => {
      const job = infraRunner.getJob(params.id);
      if (!job) {
        set.status = 404;
        return { error: "not_found" };
      }
      return job;
    })
    .get("/infra/jobs/:id/stream", ({ params }) =>
      sseStreamForJob(
        (id) => infraRunner.getJob(id),
        (id, fn) => infraRunner.subscribe(id, fn as (event: InfraJobEvent) => void),
        params.id,
      ),
    )
    .get("/infra/tailscale-db/status", async () => infraRunner.getTailnetDbStatus())
    .post(
      "/infra/tailscale-db/apply",
      async ({ body, set }) => {
        const result = await infraRunner.start({
          kind: "tailscale-db-apply",
          payload: body,
        });
        if (!result.ok) {
          set.status = 409;
          return { error: "active_job_exists", activeJob: result.activeJob };
        }
        set.status = 202;
        return {
          jobId: result.job.id,
          startedAt: result.job.startedAt,
        };
      },
      {
        body: t.Object({
          hostname: t.String({ minLength: 1, maxLength: 63 }),
          tag: t.String({ minLength: 1, maxLength: 128 }),
          auth: t.Union([
            t.Object({
              method: t.Literal("auth_key"),
              authKey: t.String({ minLength: 1, maxLength: 4096 }),
            }),
            t.Object({
              method: t.Literal("oauth_client"),
              oauthClientId: t.String({ minLength: 1, maxLength: 512 }),
              oauthClientSecret: t.String({ minLength: 1, maxLength: 4096 }),
            }),
          ]),
        }),
      },
    )
    .post("/infra/tailscale-db/disable", async ({ set }) => {
      const result = await infraRunner.start({ kind: "tailscale-db-disable" });
      if (!result.ok) {
        set.status = 409;
        return { error: "active_job_exists", activeJob: result.activeJob };
      }
      set.status = 202;
      return {
        jobId: result.job.id,
        startedAt: result.job.startedAt,
      };
    })
    .get("/services/status", async () => serviceOpsRunner.getStatus())
    .get("/services/jobs/active", () => ({ job: serviceOpsRunner.getActive() }))
    .get("/services/jobs/:id", ({ params, set }) => {
      const job = serviceOpsRunner.getJob(params.id);
      if (!job) {
        set.status = 404;
        return { error: "not_found" };
      }
      return job;
    })
    .get("/services/jobs/:id/stream", ({ params }) =>
      sseStreamForJob(
        (id) => serviceOpsRunner.getJob(id),
        (id, fn) =>
          serviceOpsRunner.subscribe(
            id,
            fn as (event: ServiceOperationEvent) => void,
          ),
        params.id,
      ),
    )
    .post(
      "/services/:service/restart",
      async ({ params, set }) => {
        if (!isControllableService(params.service)) {
          set.status = 400;
          return { error: "service_not_controllable" };
        }

        const result = await serviceOpsRunner.start({
          kind: "restart-service",
          service: params.service,
        });
        if (!result.ok) {
          set.status = 409;
          return { error: "active_job_exists", activeJob: result.activeJob };
        }

        set.status = 202;
        return {
          jobId: result.job.id,
          startedAt: result.job.startedAt,
        };
      },
      {
        params: t.Object({
          service: t.String({ minLength: 1, maxLength: 64 }),
        }),
      },
    )
    .post("/services/agent-containers/cleanup-exited", async ({ set }) => {
      const result = await serviceOpsRunner.start({
        kind: "cleanup-exited-agent-containers",
      });
      if (!result.ok) {
        set.status = 409;
        return { error: "active_job_exists", activeJob: result.activeJob };
      }

      set.status = 202;
      return {
        jobId: result.job.id,
        startedAt: result.job.startedAt,
      };
    });

  return new Elysia().use(publicRoutes).use(protectedRoutes);
};
