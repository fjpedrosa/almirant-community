import { Elysia, t } from "elysia";
import {
  getTailscaleStatus,
  enableTailscaleServe,
  disableTailscaleServe,
  getCopyPasteCommand,
} from "../services/tailscale-service";
import { updateInstanceConfig } from "../services/instance-config-service";
import {
  successResponse,
  errorResponse,
} from "../../../shared/services/response";
import { requireAdmin } from "../../../middleware/require-admin.middleware";

export const tailscaleRoutes = new Elysia({ prefix: "/instance" })
  .use(requireAdmin)

  // GET /instance/tailscale/status
  .get("/tailscale/status", async () => {
    try {
      const status = await getTailscaleStatus();
      return successResponse(status);
    } catch (err) {
      return errorResponse(
        `Failed to check Tailscale status: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })

  // POST /instance/tailscale/serve
  .post(
    "/tailscale/serve",
    async ({ body }) => {
      const port = body.port ?? 8080;

      try {
        const result = await enableTailscaleServe(port);
        return successResponse({
          ...result,
          copyPasteCommand: getCopyPasteCommand(port),
        });
      } catch (err) {
        return errorResponse(
          `Failed to enable Tailscale serve: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    {
      body: t.Object({
        port: t.Optional(
          t.Number({ minimum: 1, maximum: 65535, default: 8080 }),
        ),
      }),
    },
  )

  // DELETE /instance/tailscale/serve
  .delete(
    "/tailscale/serve",
    async ({ body }) => {
      try {
        const result = await disableTailscaleServe(body.port);
        return successResponse(result);
      } catch (err) {
        return errorResponse(
          `Failed to disable Tailscale serve: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    {
      body: t.Object({
        port: t.Number({ minimum: 1, maximum: 65535 }),
      }),
    },
  )

  // POST /instance/public-url
  .post(
    "/public-url",
    async ({ body }) => {
      try {
        const url = new URL(body.publicUrl);
        if (url.protocol !== "https:") {
          return errorResponse("publicUrl must use HTTPS");
        }

        const config = await updateInstanceConfig({
          publicUrl: body.publicUrl,
        });

        return successResponse({ publicUrl: config.publicUrl });
      } catch (err) {
        if (err instanceof TypeError) {
          return errorResponse("Invalid URL format");
        }
        return errorResponse(
          `Failed to update public URL: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    {
      body: t.Object({
        publicUrl: t.String({ format: "uri" }),
      }),
    },
  );
