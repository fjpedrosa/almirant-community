import { Elysia, t } from "elysia";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { logger } from "@almirant/config";
import { updateConnectionValidation } from "@almirant/database";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import { isAiConfigured } from "../../../ai/shared/services/ai-service";
import {
  getDefaultModel,
  isAuthError,
  resolveModelFromProviderKey,
} from "../../../ai/shared/services/model-factory";
import { errorResponse } from "../../../../shared/services/response";
import { buildSkillInterviewSystemPrompt } from "../services/skill-interview-prompt";

const SKILL_MD_BLOCK_REGEX = /```skill-md\s*([\s\S]*?)```/i;

interface SkillInterviewRequestBody {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  projectId?: string;
  providerKeyId?: string;
  modelName?: string;
}

const extractSkillFile = (content: string): string | null => {
  const match = content.match(SKILL_MD_BLOCK_REGEX);
  return match?.[1]?.trim() ?? null;
};

export const skillInterviewRoutes = new Elysia({ prefix: "/ai/skill-interview" })
  .use(sessionContextTypes)
  .post(
    "/",
    async ({ body, set }) => {
      const { messages, providerKeyId, modelName } =
        body as SkillInterviewRequestBody;

      let model: BaseChatModel;
      let connectionId: string | undefined;

      if (providerKeyId) {
        try {
          const resolved = await resolveModelFromProviderKey(providerKeyId, {
            modelName,
            streaming: true,
          });
          model = resolved.model;
          connectionId = resolved.connectionId;
        } catch (error) {
          logger.error(
            { error, keyId: providerKeyId },
            "Failed to resolve provider key for skill interview",
          );
          set.status = 400;
          return errorResponse(
            error instanceof Error
              ? error.message
              : "Failed to resolve provider API key",
          );
        }
      } else {
        if (!isAiConfigured()) {
          set.status = 503;
          return errorResponse(
            "AI service is not configured. Set OPENAI_API_KEY or provide a providerKeyId.",
            503,
          );
        }
        model = getDefaultModel(true);
      }

      const systemPrompt = await buildSkillInterviewSystemPrompt();
      const langchainMessages = [
        new SystemMessage(systemPrompt),
        ...messages.map((message) =>
          message.role === "user"
            ? new HumanMessage(message.content)
            : new AIMessage(message.content),
        ),
      ];

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          let fullContent = "";

          const sendEvent = (
            event: string,
            data: Record<string, unknown>,
          ) => {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          };

          try {
            const streamResponse = await model.stream(langchainMessages);

            for await (const chunk of streamResponse) {
              const content =
                typeof chunk.content === "string"
                  ? chunk.content
                  : String(chunk.content);

              if (!content) {
                continue;
              }

              fullContent += content;
              sendEvent("message", { content });
            }

            const skillContent = extractSkillFile(fullContent);
            if (skillContent) {
              sendEvent("skill-generated", { content: skillContent });
            }

            if (connectionId) {
              void updateConnectionValidation(connectionId, "valid").catch(
                (error: unknown) => {
                  logger.warn(
                    { connectionId, error },
                    "Failed to update validation status on skill interview success",
                  );
                },
              );
            }

            sendEvent("done", {});
          } catch (error) {
            if (connectionId && isAuthError(error)) {
              void updateConnectionValidation(
                connectionId,
                "invalid",
                error instanceof Error ? error.message : "Authentication failed",
              ).catch((validationError: unknown) => {
                logger.warn(
                  { connectionId, error: validationError },
                  "Failed to suspend connection after skill interview auth error",
                );
              });
            }

            logger.error({ error }, "Skill interview streaming error");
            sendEvent("error", {
              message:
                error instanceof Error ? error.message : "Unknown streaming error",
            });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    },
    {
      body: t.Object({
        messages: t.Array(
          t.Object({
            role: t.Union([t.Literal("user"), t.Literal("assistant")]),
            content: t.String(),
          }),
        ),
        projectId: t.Optional(t.String()),
        providerKeyId: t.Optional(t.String()),
        modelName: t.Optional(t.String()),
      }),
    },
  );
