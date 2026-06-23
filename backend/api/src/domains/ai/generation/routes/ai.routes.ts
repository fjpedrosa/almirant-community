import { Elysia, t } from "elysia";
import { isAiConfigured, formatText } from "../../shared/services/ai-service";
import { resolveModelFromProviderKey, withAuthErrorDetection } from "../../shared/services/model-factory";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { listAiModelPricing } from "../../../billing/quota/services/ai-model-pricing";
import { successResponse, errorResponse } from "../../../../shared/services/response";
import { logger } from "@almirant/config";
import { transcribeAudio, isGroqConfigured } from "../../shared/services/groq-transcription-service";
import { getAiProviderKeyById } from "@almirant/database";

const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export const aiRoutes = new Elysia({ prefix: "/ai" })
  .get("/model-pricing", async () => {
    return successResponse(listAiModelPricing());
  })
  .post(
    "/format-text",
    async (ctx) => {
      const { body, set } = ctx;
      const user = (ctx as { user?: { locale?: string } }).user;
      const locale = user?.locale ?? "es";

      if (!body.providerKeyId && !isAiConfigured()) {
        set.status = 503;
        return errorResponse("AI service is not configured. Set OPENAI_API_KEY.", 503);
      }

      let model: BaseChatModel | undefined;
      let connectionId: string | undefined;
      if (body.providerKeyId) {
        // Verify ownership of the provider key before resolving
        const userId = (ctx as unknown as { user: { id: string } }).user.id;
        const orgId = (ctx as unknown as { activeOrganization: { id: string } }).activeOrganization.id;

        const providerKey = await getAiProviderKeyById(body.providerKeyId);
        if (!providerKey) {
          set.status = 404;
          return errorResponse("Provider key not found");
        }

        const isOwner =
          (providerKey.scope === "user" && providerKey.scopeId === userId) ||
          (providerKey.scope === "organization" && providerKey.scopeId === orgId);

        if (!isOwner) {
          set.status = 403;
          return errorResponse("Access denied: provider key does not belong to your account", 403);
        }

        try {
          const resolved = await resolveModelFromProviderKey(body.providerKeyId);
          model = resolved.model;
          connectionId = resolved.connectionId;
        } catch (err) {
          logger.error({ error: err, keyId: body.providerKeyId }, "Failed to resolve provider key");
          set.status = 400;
          return errorResponse(
            err instanceof Error ? err.message : "Failed to resolve provider API key"
          );
        }
      }

      try {
        const run = () => formatText(body.text, body.fieldContext, model, locale);
        const formattedText = connectionId
          ? await withAuthErrorDetection(connectionId, run)
          : await run();
        return successResponse({ formattedText });
      } catch (error) {
        logger.error(error, "AI format-text error");
        set.status = 500;
        return errorResponse("Error formatting text with AI", 500);
      }
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1 }),
        fieldContext: t.Union([
          t.Literal("description"),
          t.Literal("definitionOfDone"),
          t.Literal("prompt"),
          t.Literal("multiPrompt"),
          t.Literal("sharePost"),
        ]),
        providerKeyId: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/transcribe",
    async ({ body, set }) => {
      if (!isGroqConfigured()) {
        set.status = 503;
        return errorResponse("Transcription service is not configured. Set GROQ_API_KEY.", 503);
      }

      const file = body.file;
      if (!file) {
        set.status = 400;
        return errorResponse("Audio file is required");
      }

      if (file.size > MAX_AUDIO_FILE_SIZE) {
        set.status = 400;
        return errorResponse(
          `File size exceeds limit of 25MB. Current size: ${(file.size / 1024 / 1024).toFixed(2)}MB`
        );
      }

      try {
        const buffer: Uint8Array = new Uint8Array(await file.arrayBuffer());
        const result = await transcribeAudio(
          buffer,
          file.name || "audio.webm",
          file.type || "audio/webm",
          body.language
        );
        return successResponse({ text: result.text });
      } catch (error) {
        logger.error({ error }, "Transcription error");
        set.status = 500;
        const message = error instanceof Error ? error.message : "Transcription failed";
        return errorResponse(message, 500);
      }
    },
    {
      body: t.Object({
        file: t.File(),
        language: t.Optional(t.String()),
      }),
    }
  );
