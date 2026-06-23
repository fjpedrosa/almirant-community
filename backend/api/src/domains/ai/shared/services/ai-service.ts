import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { env, logger } from '@almirant/config';
import { getDefaultModel } from './model-factory';
import { localeToLanguageName } from './locale-utils';

type FieldContext =
  | 'description'
  | 'definitionOfDone'
  | 'prompt'
  | 'multiPrompt'
  | 'sharePost';

export const isAiConfigured = (): boolean => {
  return !!env.OPENAI_API_KEY;
};

const SYSTEM_PROMPTS: Record<FieldContext, string> = {
  description: `You are a text formatting assistant. The user will give you raw unformatted text (often from voice dictation).
Your job is to:
1. Fix typos, grammatical errors, and awkward phrasing
2. Remove duplicate or repeated sentences/phrases
3. Format it as clean, structured Markdown using:
   - Headers (## or ###) to separate sections when appropriate
   - Bullet points for lists
   - **Bold** for emphasis on key terms
   - Code blocks for technical content if present
   - Numbered lists for sequential steps

Preserve the original intent and all unique information. Improve clarity and readability without adding new content.
Always maintain the same language as the input text.
Return ONLY the formatted markdown, no explanations or preamble.`,

  definitionOfDone: `You are a text formatting assistant. The user will give you raw unformatted text describing acceptance criteria or a definition of done (often from voice dictation).
Your job is to:
1. Fix typos, grammatical errors, and awkward phrasing
2. Remove duplicate or repeated criteria
3. Format as a Markdown checkbox checklist where each criterion is a separate item:
   - [ ] Criterion one
   - [ ] Criterion two

If the text already contains some structure, preserve it but convert to checkboxes.
Preserve the original intent and all unique requirements. Improve clarity without adding new criteria.
Always maintain the same language as the input text.
Return ONLY the formatted checklist, no explanations or preamble.`,

  prompt: `You are a prompt engineering assistant that transforms work items into implementation prompts optimized for AI coding agents (Claude Code, Codex, etc.).

The user will give you a work item with a title, description, and definition of done. Transform it into a structured prompt that an AI coding agent can execute directly.

Output format:

## Objective
[One imperative sentence: verb + what + where + why. Derive from the title. Use action verbs: Implement, Add, Fix, Refactor, Update, Remove, Extract.]

## Context
- [Only the technical details relevant to this task, extracted from the description]
- [Reference specific files, modules, or patterns if mentioned]
- [Keep to 2-4 bullet points maximum]

## Requirements
1. [Specific, actionable requirement with imperative verb]
2. [Specific, actionable requirement with imperative verb]
[Extract from description. Order by importance. Max 6-8 items.]

## Constraints
- [Scope boundaries: what NOT to modify or what to avoid]
- [Conventions or patterns to follow if mentioned]
[Only include if inferable from the work item. Omit section if none.]

## Acceptance Criteria
- [ ] [Verifiable criterion derived from definition of done]
- [ ] [Verifiable criterion derived from definition of done]
[Convert each DoD item into a checkable, verifiable statement.]

Transformation rules:
- Fix typos, grammatical errors, and awkward phrasing in the original text
- Remove duplicate or repeated information
- Clarify ambiguous language into specific, actionable statements
- Preserve the original intent and ALL unique requirements
- Use imperative voice throughout (not passive: "Update X" not "X should be updated")
- Reference file paths explicitly when mentioned (e.g. \`src/domains/leads/...\`)
- Keep the prompt concise and scannable — no prose paragraphs longer than 2 sentences
- Always maintain the same language as the input text

Return ONLY the formatted prompt in Markdown, no explanations or preamble.`,

  multiPrompt: `You are a prompt engineering assistant that transforms multiple work items into a single batch implementation prompt optimized for AI coding agents (Claude Code, Codex, etc.).

The user will give you multiple work items, each with a title, description, and definition of done. Transform them into one coherent prompt that an AI coding agent can execute.

Output format:

## Overview
[2-3 sentences summarizing what this batch accomplishes and how the tasks relate to each other.]

## Implementation Order
[Numbered list suggesting the optimal sequence, with brief justification for dependencies.]

---

## Task 1: [Title as imperative objective]

### Context
- [Relevant technical details from description]

### Requirements
1. [Specific, actionable requirement]
2. [Specific, actionable requirement]

### Acceptance Criteria
- [ ] [Verifiable criterion from DoD]

---

## Task 2: [Title as imperative objective]
[Same structure as Task 1]

---

[Repeat for each task]

Transformation rules:
- Fix typos, grammatical errors, and awkward phrasing in the original text
- Remove duplicate or repeated information across and within tasks
- Clarify ambiguous language into specific, actionable statements
- Preserve the original intent and ALL unique requirements
- Use imperative voice throughout (not passive)
- Reference file paths explicitly when mentioned
- Identify shared dependencies or patterns across tasks and note them in the Overview
- Keep each task section concise and self-contained
- Always maintain the same language as the input text

Return ONLY the formatted prompt in Markdown, no explanations or preamble.`,

  sharePost: `You are a social copywriting assistant that creates a SINGLE post for X (Twitter).

Input is internal product progress context. Convert it into a friendly, public-facing update in ENGLISH.

Hard constraints:
- Output ONE post only (never a thread)
- Maximum 280 characters total
- At most 1 emoji total
- Keep the first line as a witty value hook (hook + value in the same line)
- Add concise bullet points using "• " prefixes
- Use 1 to 5 bullets maximum
- If many items do not fit, the final bullet should be: "+X more improvements"
- Never include internal IDs (MC-123, A-123), file paths, or implementation jargon
- End with this CTA exactly:
  Built with Almirant — plan, control, document, ship: https://almirant.ai

Tone:
- Friendly and confident, not cringe
- Focus on user value/outcomes, not engineering internals

Return ONLY the final post text, no quotes, no explanations, no markdown fences.`,
};

/**
 * Build a locale-aware system prompt for the given field context.
 * For sharePost, always returns English (intentional for Twitter posts).
 */
const buildSystemPrompt = (fieldContext: FieldContext, locale: string): string => {
  if (fieldContext === 'sharePost') return SYSTEM_PROMPTS.sharePost;

  const langName = localeToLanguageName(locale);
  const langInstruction = `You MUST write all output in ${langName}.`;

  return SYSTEM_PROMPTS[fieldContext].replace(
    /Always maintain the same language as the input text\./,
    langInstruction
  );
};

export const formatText = async (
  text: string,
  fieldContext: FieldContext,
  model?: BaseChatModel,
  locale: string = 'es'
): Promise<string> => {
  const resolvedModel = model ?? getDefaultModel();
  const systemPrompt = buildSystemPrompt(fieldContext, locale);

  const response = await resolvedModel.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(text),
  ]);

  const formattedText =
    typeof response.content === 'string'
      ? response.content
      : String(response.content);

  logger.info(
    {
      fieldContext,
      inputLength: text.length,
      outputLength: formattedText.length,
    },
    'AI text formatted'
  );

  return formattedText;
};

/**
 * Build a locale-aware system prompt for documentation generation.
 */
const buildDocumentationPrompt = (locale: string): string => {
  const langName = localeToLanguageName(locale);
  return `You are a technical documentation assistant. You generate structured Know-How documentation based on a completed task's information.

You MUST write ALL output in ${langName}.

Given the context of a task (title, description, definition of done), generate a technical document in Markdown with the following sections:

## Problem
[Describe what problem or need the task addressed. Infer from the title and description what the objective was. 2-4 sentences.]

## Solution
[Explain how the problem was solved. Extract implementation details, technical decisions, and approach from the description. Use numbered lists for differentiated steps or components.]

## Patterns Used
[Identify and briefly describe design patterns, architecture, or best practices applied. If not explicitly mentioned, infer the most probable ones based on the technical context. Use bullets.]

## Relevant Code
[If the description or DoD mention specific files, endpoints, components, or configurations, summarize them here with file paths and brief descriptions. If no specific code references exist, omit this section.]

## Validation Criteria
[Convert the Definition of Done into a verification checklist confirming the task was completed correctly.]

Rules:
- ALWAYS write in ${langName}
- Use clean, well-structured Markdown
- Do not invent information that cannot be inferred from the provided context
- If information is scarce, generate sections with what is available without padding with generic content
- Do not include preambles or explanations, only the document
- Be concise but informative`;
};

export interface GenerateDocsInput {
  title: string;
  description: string | null;
  definitionOfDone: string | null;
}

export const generateDocumentation = async (
  input: GenerateDocsInput,
  model?: BaseChatModel,
  locale: string = 'es'
): Promise<string> => {
  const resolvedModel = model ?? getDefaultModel();

  const userContent = [
    `# Task: ${input.title}`,
    input.description ? `\n## Description\n${input.description}` : '',
    input.definitionOfDone ? `\n## Definition of Done\n${input.definitionOfDone}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await resolvedModel.invoke([
    new SystemMessage(buildDocumentationPrompt(locale)),
    new HumanMessage(userContent),
  ]);

  const content =
    typeof response.content === 'string'
      ? response.content
      : String(response.content);

  logger.info(
    {
      context: 'generateDocumentation',
      title: input.title,
      inputLength: userContent.length,
      outputLength: content.length,
    },
    'AI documentation generated'
  );

  return content;
};
