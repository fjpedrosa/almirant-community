import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { logger } from "@almirant/config";
import { errorResponse } from "../../../../shared/services/response";
import { isAiConfigured } from "../../shared/services/ai-service";
import {
  resolveModelFromProviderKey,
  isAuthError,
  getDefaultModel,
} from "../../shared/services/model-factory";
import { updateConnectionValidation } from "@almirant/database";

// ---------------------------------------------------------------------------
// Rate limiter (in-memory, per user)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;

/** Map<userId, timestamps[]> */
const rateLimitMap = new Map<string, number[]>();

const isRateLimited = (userId: string): boolean => {
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) ?? [];

  // Remove entries outside the window
  const recent = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  rateLimitMap.set(userId, recent);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  recent.push(now);
  return false;
};

// ---------------------------------------------------------------------------
// Skill definition parsing
// ---------------------------------------------------------------------------

const SKILL_DEFINITION_REGEX = /```skill-definition\s*([\s\S]*?)```/;

interface ParsedSkillDefinition {
  name: string;
  description: string;
  content: string;
}

const parseSkillDefinition = (
  text: string
): ParsedSkillDefinition | null => {
  const match = text.match(SKILL_DEFINITION_REGEX);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (
      typeof parsed.name === "string" &&
      typeof parsed.description === "string" &&
      typeof parsed.content === "string"
    ) {
      return {
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
      };
    }
    return null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const buildSkillGenerationSystemPrompt = (
  currentSkill?: { name: string; description: string; content: string }
): string => {
  const base = `You are a skill generation assistant for the Almirant platform.

## What is a Skill?

A Skill is a reusable instruction set that AI agents use when performing tasks. Each skill has:
- **name**: A short, descriptive name (e.g., "React Component Generator", "API Endpoint Builder")
- **description**: A one-line summary of what the skill does
- **content**: The full skill instructions in Markdown format

## Skill Content Structure

The content field should be well-structured Markdown that includes:
1. A clear purpose statement
2. Step-by-step instructions or guidelines
3. Code patterns, templates, or examples when relevant
4. Constraints and best practices
5. Expected output format

## Your Role

Guide the user through creating or refining a skill. Ask clarifying questions when needed:
- What should the skill do?
- What technology or domain does it target?
- Are there specific patterns or conventions to follow?
- What output format should the agent produce?

## Output Format

When you have enough information to generate a complete skill, include a \`\`\`skill-definition code block with a JSON object containing \`name\`, \`description\`, and \`content\` fields. Example:

\`\`\`skill-definition
{
  "name": "Example Skill Name",
  "description": "Brief description of the skill purpose",
  "content": "# Example Skill\\n\\n## Purpose\\nThis skill does X.\\n\\n## Instructions\\n1. Step one\\n2. Step two\\n\\n## Examples\\n..."
}
\`\`\`

Always include the skill-definition block when you have generated or refined a skill. The content field must contain valid Markdown with proper newline escaping for JSON.

Be conversational and helpful. If the user's request is vague, ask focused questions before generating. If they provide enough detail, generate the skill immediately.`;

  if (currentSkill) {
    return `${base}

## Current Skill Being Refined

The user is refining an existing skill. Here is its current state:

**Name**: ${currentSkill.name}
**Description**: ${currentSkill.description}
**Content**:
${currentSkill.content}

Help the user improve this skill based on their feedback. Always output the full updated skill in a \`\`\`skill-definition block when making changes.`;
  }

  return base;
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const aiSkillGenerateRoutes = new Elysia({ prefix: "/ai" })
  .use(sessionContextTypes)

  // POST /ai/generate-skill — SSE streaming skill generation chat
  .post(
    "/generate-skill",
    async ({ body, set, user }) => {
      const userId = user?.id;
      if (!userId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }

      // Rate limiting
      if (isRateLimited(userId)) {
        set.status = 429;
        return errorResponse(
          "Rate limit exceeded. Maximum 10 requests per minute.",
          429
        );
      }

      const { messages, currentSkill, providerKeyId, modelName } = body;

      // Resolve the chat model
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
        } catch (err) {
          logger.error(
            { error: err, keyId: providerKeyId },
            "Failed to resolve provider key for skill generation"
          );
          set.status = 400;
          return errorResponse(
            err instanceof Error
              ? err.message
              : "Failed to resolve provider API key"
          );
        }
      } else {
        if (!isAiConfigured()) {
          set.status = 503;
          return errorResponse(
            "AI service is not configured. Set OPENAI_API_KEY or provide a providerKeyId.",
            503
          );
        }
        model = getDefaultModel(true);
      }

      // Build message chain
      const systemPrompt = buildSkillGenerationSystemPrompt(
        currentSkill ?? undefined
      );
      const langchainMessages = [
        new SystemMessage(systemPrompt),
        ...messages.map((msg) =>
          msg.role === "user"
            ? new HumanMessage(msg.content)
            : new AIMessage(msg.content)
        ),
      ];

      // Create SSE readable stream
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          let fullContent = "";

          const sendEvent = (
            event: string,
            data: Record<string, unknown>
          ) => {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
              )
            );
          };

          try {
            const streamResponse = await model.stream(langchainMessages);

            for await (const chunk of streamResponse) {
              const content =
                typeof chunk.content === "string"
                  ? chunk.content
                  : String(chunk.content);

              if (content) {
                fullContent += content;
                sendEvent("message", { content });
              }
            }

            // After streaming, check for a skill-definition block
            const parsedSkill = parseSkillDefinition(fullContent);
            if (parsedSkill) {
              sendEvent("skill", {
                name: parsedSkill.name,
                description: parsedSkill.description,
                content: parsedSkill.content,
              });
            }

            // Mark connection as valid after successful streaming
            if (connectionId) {
              void updateConnectionValidation(connectionId, "valid").catch(
                (validErr: unknown) => {
                  logger.warn(
                    { connectionId, error: validErr },
                    "Failed to update validation status on skill generation success"
                  );
                }
              );
            }

            sendEvent("done", {});
          } catch (err) {
            // Detect auth errors and suspend the connection
            if (connectionId && isAuthError(err)) {
              logger.warn(
                { connectionId, error: err },
                "Auth error detected from AI provider during skill generation streaming, suspending connection"
              );
              void updateConnectionValidation(
                connectionId,
                "invalid",
                err instanceof Error
                  ? err.message
                  : "Authentication failed"
              ).catch((suspendErr: unknown) => {
                logger.warn(
                  { connectionId, error: suspendErr },
                  "Failed to suspend connection after skill generation streaming auth error"
                );
              });
            }

            const message =
              err instanceof Error
                ? err.message
                : "Unknown streaming error";
            logger.error({ error: err }, "AI skill generation streaming error");
            sendEvent("error", { message });
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
          })
        ),
        currentSkill: t.Optional(
          t.Object({
            name: t.String(),
            description: t.String(),
            content: t.String(),
          })
        ),
        providerKeyId: t.Optional(t.String()),
        modelName: t.Optional(t.String()),
      }),
    }
  );
