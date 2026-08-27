import { Elysia } from "elysia";
import {
  runtimeCapabilityProjection as RUNTIME_CAPABILITY_PROJECTION,
} from "@almirant/shared";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import { errorResponse } from "../../../shared/services/response";
import { buildRuntimeControls } from "../services/scheduled-agent-runtime-validation";

const PI_ADMISSION_HEADER = "X-Almirant-Pi-Admission";

/**
 * Authenticated, read-only discovery surface for the canonical runtime contract.
 * Canonical projection fields stay byte-identical while live operator controls
 * are exposed as additive response metadata.
 */
export const runtimeCapabilitiesRoutes = new Elysia({
  prefix: "/runtime-capabilities",
})
  .use(sessionContextTypes)
  .get("/", ({ user, activeWorkspace, set }) => {
    if (!user?.id || !activeWorkspace?.id) {
      set.status = 401;
      return errorResponse("Authentication required", 401, "unauthorized");
    }

    const runtimeControls = buildRuntimeControls();
    const admissionState = runtimeControls.piCodingAgentAdmission.enabled
      ? "enabled"
      : "disabled";
    set.headers["Cache-Control"] = "private, max-age=300";
    set.headers[PI_ADMISSION_HEADER] =
      `${admissionState}; code=${runtimeControls.piCodingAgentAdmission.code}`;
    return {
      ...RUNTIME_CAPABILITY_PROJECTION,
      runtimeControls,
    };
  });
