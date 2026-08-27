import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import {
  runtimeCapabilityProjection as RUNTIME_CAPABILITY_PROJECTION,
} from "@almirant/shared";
import { runtimeCapabilitiesRoutes } from "./runtime-capabilities.routes";

const createAuthenticatedApp = () =>
  new Elysia()
    .derive(() => ({
      user: { id: "user-test-1" } as never,
      activeWorkspace: { id: "org-test-1" } as never,
      memberRole: "owner",
    }))
    .use(runtimeCapabilitiesRoutes);

const request = (method = "GET") =>
  new Request("http://localhost/runtime-capabilities/", { method });

const staticProjectionBytes = JSON.stringify(RUNTIME_CAPABILITY_PROJECTION);

const withPiAdmissionEnvironment = async <T>(
  value: "true" | "false" | undefined,
  action: () => Promise<T>,
): Promise<T> => {
  const previous = process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
  if (value === undefined) {
    delete process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
  } else {
    process.env.PI_CODING_AGENT_ADMISSION_ENABLED = value;
  }
  try {
    return await action();
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
    } else {
      process.env.PI_CODING_AGENT_ADMISSION_ENABLED = previous;
    }
  }
};

describe("runtime capabilities REST route", () => {
  it.each([
    ["default", undefined, true, "PI_ADMISSION_ENABLED"],
    ["enabled", "true", true, "PI_ADMISSION_ENABLED"],
    ["disabled", "false", false, "PI_ADMISSION_DISABLED"],
  ] as const)(
    "preserves the canonical projection and exposes authenticated %s Pi producer admission",
    async (_label, admissionValue, enabled, code) =>
      withPiAdmissionEnvironment(admissionValue, async () => {
        const response = await createAuthenticatedApp().handle(request());

        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown> & {
          runtimeControls: {
            piCodingAgentAdmission: {
              enabled: boolean;
              code: string;
            };
          };
        };
        const { runtimeControls, ...projectionFields } = body;
        expect(projectionFields).toEqual(RUNTIME_CAPABILITY_PROJECTION);
        expect(runtimeControls).toEqual({
          piCodingAgentAdmission: { enabled, code },
        });
        expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
        const admissionHeader = response.headers.get("X-Almirant-Pi-Admission");
        expect(admissionHeader).toBe(
          `${enabled ? "enabled" : "disabled"}; code=${code}`,
        );
        expect(admissionHeader!.length).toBeLessThanOrEqual(64);
        expect(JSON.stringify(RUNTIME_CAPABILITY_PROJECTION)).toBe(
          staticProjectionBytes,
        );
        expect(RUNTIME_CAPABILITY_PROJECTION).not.toHaveProperty("runtimeControls");
      }),
  );

  it("rejects requests without authenticated session context", async () => {
    const response = await new Elysia()
      .use(runtimeCapabilitiesRoutes)
      .handle(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "unauthorized",
    });
  });

  it("exposes no mutation method", async () => {
    const response = await createAuthenticatedApp().handle(request("POST"));

    expect(response.status).toBe(404);
  });
});
