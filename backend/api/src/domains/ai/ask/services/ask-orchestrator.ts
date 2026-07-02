// ---------------------------------------------------------------------------
// Ask Feature -- Orchestrator
// ---------------------------------------------------------------------------
// Main orchestration function that chains: query planning -> retrieval ->
// reranking -> LLM synthesis -> response with confidence and citations.
// Implements abstention policy when evidence is insufficient.
// ---------------------------------------------------------------------------

import { env, logger } from "@almirant/config";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { planQuery } from "./query-planner";
import { retrieveEvidence, MAX_CITATIONS_PER_RESPONSE } from "./retrieval-service";
import { rerankEvidence, computeConfidence } from "./reranker";
import { sanitizeQuestion, sanitizeOutput, validateProjectAccess } from "./security-guardrails";
import type { RankedEvidence } from "./reranker";
import {
  ASK_ABSTENTION_THRESHOLD,
  toConfidenceLevel,
} from "./types";
import type {
  AskRequest,
  AskResponse,
  AskCitation,
  AskErrorCode,
} from "./types";
import { createAskTimer, estimateTokens, recordAskMetrics } from "./metrics-service";
import { evaluateResponse } from "./evaluation-service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters of evidence context to send to the LLM (~4000 tokens) */
const MAX_CONTEXT_CHARS = 12_000;

/** Timeout for the LLM synthesis call in milliseconds */
const LLM_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Error class for domain-specific Ask errors
// ---------------------------------------------------------------------------

export class AskError extends Error {
  constructor(
    public readonly code: AskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AskError";
  }
}

// ---------------------------------------------------------------------------
// LLM system prompt
// ---------------------------------------------------------------------------

const SYNTHESIS_SYSTEM_PROMPT = `You are a project intelligence assistant. Answer the user's question based ONLY on the evidence provided below. Follow these rules strictly:

1. Base your answer ONLY on the provided evidence. Do NOT hallucinate or infer information not present in the evidence.
2. Cite sources using [1], [2], etc. notation matching the citation numbers in the evidence list.
3. If the evidence is insufficient to fully answer the question, explicitly state what information is missing.
4. Keep your answer concise, factual, and well-structured using Markdown.
5. If multiple pieces of evidence conflict, acknowledge the discrepancy.
6. Use bullet points or numbered lists when presenting multiple items.
7. Always respond in the same language as the user's question.`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the evidence context string for the LLM prompt, respecting the
 * maximum character budget. Each piece of evidence is numbered for citation.
 */
const buildEvidenceContext = (ranked: RankedEvidence[]): string => {
  const parts: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < ranked.length; i++) {
    const item = ranked[i]!;
    const content = item.content ?? item.excerpt ?? item.title;
    const truncatedContent =
      content.length > 1500 ? content.slice(0, 1500) + "..." : content;

    const entry = `[${i + 1}] (${item.sourceType}) "${item.title}"\n${truncatedContent}\n`;

    if (totalChars + entry.length > MAX_CONTEXT_CHARS) {
      break;
    }

    parts.push(entry);
    totalChars += entry.length;
  }

  return parts.join("\n");
};

/**
 * Synthesize an answer using the LLM (OpenAI via LangChain).
 * Falls back to a formatted evidence summary if no API key is configured.
 */
const synthesizeAnswer = async (
  question: string,
  ranked: RankedEvidence[],
): Promise<string> => {
  const evidenceContext = buildEvidenceContext(ranked);

  if (!env.OPENAI_API_KEY) {
    logger.warn("ask: OPENAI_API_KEY not configured, using evidence summary fallback");
    return buildFallbackAnswer(question, ranked);
  }

  try {
    const model = new ChatOpenAI({
      openAIApiKey: env.OPENAI_API_KEY,
      modelName: env.OPENAI_MODEL ?? "gpt-4.1-nano",
      timeout: LLM_TIMEOUT_MS,
    });

    const userPrompt = `## Evidence\n\n${evidenceContext}\n\n## Question\n\n${question}`;

    const response = await model.invoke([
      new SystemMessage(SYNTHESIS_SYSTEM_PROMPT),
      new HumanMessage(userPrompt),
    ]);

    const answer =
      typeof response.content === "string"
        ? response.content
        : String(response.content);

    logger.info(
      {
        questionLength: question.length,
        evidenceCount: ranked.length,
        answerLength: answer.length,
      },
      "ask: LLM synthesis completed",
    );

    return answer;
  } catch (error) {
    logger.error({ error }, "ask: LLM synthesis failed, falling back to evidence summary");
    return buildFallbackAnswer(question, ranked);
  }
};

/**
 * Build a structured fallback answer from ranked evidence when the LLM
 * is unavailable. Formats the top evidence items as a readable summary.
 */
const buildFallbackAnswer = (
  _question: string,
  ranked: RankedEvidence[],
): string => {
  const lines: string[] = [
    "Based on the available evidence, here is a summary of relevant information:\n",
  ];

  for (let i = 0; i < Math.min(ranked.length, 5); i++) {
    const item = ranked[i]!;
    const excerpt = item.excerpt ?? item.content?.slice(0, 200) ?? item.title;
    lines.push(`**[${i + 1}] ${item.title}** (${item.sourceType})`);
    lines.push(`${excerpt}\n`);
  }

  lines.push(
    "\n*Note: This is an automated summary. AI-powered synthesis is currently unavailable.*",
  );

  return lines.join("\n");
};

/**
 * Map ranked evidence items to citation objects for the response.
 */
const buildCitations = (ranked: RankedEvidence[]): AskCitation[] => {
  return ranked.map((item) => ({
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    title: item.title,
    excerpt: item.excerpt ?? item.content?.slice(0, 200) ?? item.title,
    timestamp: item.sourceTimestamp?.toISOString() ?? new Date().toISOString(),
  }));
};

/**
 * Build an abstention response when confidence is below the threshold
 * or no evidence was found.
 */
const buildAbstentionResponse = (
  request: AskRequest,
  confidence: number,
): AskResponse => {
  const hasEvidence = confidence > 0;

  const answer = hasEvidence
    ? "I found some related information, but the evidence is not sufficient to provide a reliable answer to your question. Please try rephrasing your question or narrowing the scope."
    : "I could not find any relevant information in this project to answer your question. Please verify the project scope or try a different question.";

  return {
    answer,
    confidence,
    confidenceLevel: toConfidenceLevel(confidence),
    citations: [],
    isAbstention: true,
    sessionId: crypto.randomUUID(),
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main Ask orchestration pipeline:
 *
 * 1. Plan the query (strategy, filters, FTS query)
 * 2. Retrieve evidence from multiple sources
 * 3. Rerank evidence with diversity and recency factors
 * 4. Compute confidence score
 * 5. Check abstention threshold -- return early if insufficient evidence
 * 6. Synthesize answer via LLM (with fallback)
 * 7. Build citations from ranked evidence
 * 8. Return structured response
 */
export const orchestrateAsk = async (
  request: AskRequest,
  workspaceId: string,
): Promise<AskResponse> => {
  const timer = createAskTimer();
  timer.start("total");

  logger.info(
    {
      projectId: request.projectId,
      questionLength: request.question.length,
      workspaceId,
      hasFeatureId: !!request.featureId,
      hasTimeRange: !!request.timeRange,
    },
    "ask: orchestration started",
  );

  // Step 0a: Validate project belongs to the workspace (tenancy check)
  await validateProjectAccess(workspaceId, request.projectId);

  // Step 0b: Sanitize the question (prompt injection guardrails)
  const sanitizedQuestion = sanitizeQuestion(request.question);
  const sanitizedRequest: AskRequest = { ...request, question: sanitizedQuestion };

  // Step 1: Plan the query
  timer.start("planning");
  const plan = planQuery(sanitizedRequest);
  timer.end("planning");

  // Step 2: Retrieve evidence
  timer.start("retrieval");
  const evidence = await retrieveEvidence(sanitizedRequest.projectId, plan, workspaceId);
  timer.end("retrieval");

  // Step 3: Rerank evidence
  timer.start("rerank");
  const ranked = rerankEvidence(evidence, sanitizedRequest.question, MAX_CITATIONS_PER_RESPONSE);

  // Step 4: Compute confidence
  const confidence = computeConfidence(ranked);
  timer.end("rerank");

  logger.info(
    {
      projectId: sanitizedRequest.projectId,
      evidenceCount: evidence.length,
      rankedCount: ranked.length,
      confidence,
    },
    "ask: evidence scoring completed",
  );

  const modelName = env.OPENAI_MODEL ?? "gpt-4.1-nano";

  // Step 5: Check abstention threshold
  if (confidence < ASK_ABSTENTION_THRESHOLD || ranked.length === 0) {
    logger.info(
      { confidence, rankedCount: ranked.length },
      "ask: abstaining due to low confidence or no evidence",
    );

    timer.end("total");
    const timings = timer.getAll();

    // Record metrics even for abstention responses
    try {
      recordAskMetrics({
        questionLength: sanitizedRequest.question.length,
        projectId: sanitizedRequest.projectId,
        strategy: plan.strategy,
        retrievalTimeMs: timings["retrieval"] ?? 0,
        rerankTimeMs: timings["rerank"] ?? 0,
        synthesisTimeMs: 0,
        totalTimeMs: timings["total"] ?? 0,
        evidenceCount: evidence.length,
        rankedCount: ranked.length,
        confidence,
        confidenceLevel: toConfidenceLevel(confidence),
        isAbstention: true,
        citationCount: 0,
        tokenEstimate: 0,
        model: modelName,
      });
    } catch (metricsError) {
      logger.error({ error: metricsError }, "ask: failed to record abstention metrics");
    }

    return buildAbstentionResponse(sanitizedRequest, confidence);
  }

  // Step 6: Synthesize answer via LLM
  timer.start("synthesis");
  const rawAnswer = await synthesizeAnswer(sanitizedRequest.question, ranked);
  timer.end("synthesis");

  // Step 6b: Sanitize LLM output (strip leaked prompts / PII)
  const answer = sanitizeOutput(rawAnswer);

  // Step 7: Build citations
  const citations = buildCitations(ranked);

  // Step 8: Return response
  const response: AskResponse = {
    answer,
    confidence,
    confidenceLevel: toConfidenceLevel(confidence),
    citations,
    isAbstention: false,
    sessionId: crypto.randomUUID(),
  };

  timer.end("total");
  const timings = timer.getAll();

  // Step 9: Record metrics and evaluate quality (non-blocking)
  try {
    recordAskMetrics({
      questionLength: sanitizedRequest.question.length,
      projectId: sanitizedRequest.projectId,
      strategy: plan.strategy,
      retrievalTimeMs: timings["retrieval"] ?? 0,
      rerankTimeMs: timings["rerank"] ?? 0,
      synthesisTimeMs: timings["synthesis"] ?? 0,
      totalTimeMs: timings["total"] ?? 0,
      evidenceCount: evidence.length,
      rankedCount: ranked.length,
      confidence,
      confidenceLevel: response.confidenceLevel,
      isAbstention: false,
      citationCount: citations.length,
      tokenEstimate: estimateTokens(answer),
      model: modelName,
    });

    const evaluation = evaluateResponse(answer, ranked, citations);
    logger.info(
      {
        metric: "ask_evaluation",
        projectId: sanitizedRequest.projectId,
        groundedness: evaluation.groundedness,
        citationPrecision: evaluation.citationPrecision,
        citationRecall: evaluation.citationRecall,
        answerRelevance: evaluation.answerRelevance,
        overallQuality: evaluation.overallQuality,
      },
      "ask: response quality evaluation completed",
    );
  } catch (evalError) {
    logger.error({ error: evalError }, "ask: metrics/evaluation failed (non-blocking)");
  }

  logger.info(
    {
      projectId: sanitizedRequest.projectId,
      confidenceLevel: response.confidenceLevel,
      citationCount: citations.length,
      isAbstention: false,
      totalTimeMs: timings["total"] ?? 0,
    },
    "ask: orchestration completed",
  );

  return response;
};
