# Worker Interactions API -- Endpoint Verification (A-502)

## Status: SUFFICIENT -- No changes required

The backend already provides the necessary endpoints for forwarding Discord thread
replies and polling for interaction responses. The existing API uses a different
field naming convention than the one proposed in the ticket, but it covers all the
required functionality.

---

## Endpoint 1: POST /workers/jobs/:id/interactions

**Location**: `backend/api/src/routes/workers.routes.ts` (line 831)

**Purpose**: Worker creates an interaction (asks a question). Transitions job to
`waiting_for_input`.

### Request body (Elysia schema)

```typescript
{
  questionType: "clarification" | "approval" | "choice" | "free_text",
  questionText: string,
  questionContext?: Record<string, unknown>,  // arbitrary context
  options?: string[],                         // for choice questions
  expiresAt: string,                          // ISO date
  timeoutAction?: string,                     // "fail" (default)
  defaultAnswer?: string
}
```

### Mapping from ticket fields

| Ticket field | Existing field     | Notes                                           |
|-------------|--------------------|-------------------------------------------------|
| `type`      | `questionType`     | Enum: clarification, approval, choice, free_text |
| `content`   | `questionText`     | The question text                                |
| `userId`    | N/A (worker-side)  | Worker does not set userId; it is set by the responder |
| `source`    | N/A (worker-side)  | Source is tracked on the response side via `answeredBy` and `answerMetadata` |

The `type: 'user_reply' | 'option_selected'` from the ticket maps to the response
flow, not the creation flow. When a Discord user replies:

- **option_selected**: The discord-interactions route handles this via `handleAnswerComponent()`,
  calling `respondToInteraction(id, selected, "discord:<userId>", metadata)`.
- **user_reply**: The bidirectional relay in the runner calls `respondToInteraction()`
  directly with the Discord user's message content.

### Response (201 Created)

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "agentJobId": "uuid",
    "status": "pending",
    "questionType": "choice",
    "questionText": "Which approach should I use?",
    "options": ["Option A", "Option B"],
    "answerText": null,
    "answeredAt": null,
    "expiresAt": "2024-01-01T00:10:00Z",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

---

## Endpoint 2: GET /workers/jobs/:id/interactions/:interactionId

**Location**: `backend/api/src/routes/workers.routes.ts` (line 916)

**Purpose**: Worker polls for the answer to a pending interaction.

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "agentJobId": "uuid",
    "status": "answered",
    "questionType": "choice",
    "questionText": "Which approach should I use?",
    "options": ["Option A", "Option B"],
    "answerText": "Option A",
    "answeredBy": "discord:<user-id>",
    "answerMetadata": {
      "source": "discord_component",
      "customId": "answer:job-uuid:0",
      "selected": "Option A"
    },
    "answeredAt": "2024-01-01T00:01:30Z",
    "expiresAt": "2024-01-01T00:10:00Z",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:01:30Z"
  }
}
```

The `status` field transitions through: `pending` -> `answered` | `timed_out` | `cancelled`.

When polling, check `status === "answered"` and read `answerText` for the response content.
The `answeredBy` field encodes the source (e.g. `discord:<userId>` for Discord, a user UUID
for web responses).

---

## Endpoint 3: POST /api/agent-jobs/:id/interactions/:interactionId/respond

**Location**: `backend/api/src/routes/agent-jobs.routes.ts` (line 519)

**Purpose**: User-facing endpoint to answer an interaction (session-authed).

### Request body

```typescript
{
  answerText: string,
  answerMetadata?: Record<string, unknown>
}
```

This endpoint:

1. Writes the answer via `respondToInteraction()`.
2. Transitions the job back to `running`.
3. Broadcasts `worker-interaction:responded` via WebSocket.
4. If it is a planning job, persists the answer as a planning session message.

---

## Discord Response Flow

### Slash command button responses

Handled by `discord-interactions.routes.ts` -> `handleAnswerComponent()`:

1. Discord sends MESSAGE_COMPONENT interaction.
2. Route parses `custom_id` (format: `answer:<jobId>:<optionIndex>`).
3. Finds the pending interaction for the job.
4. Resolves the selected option from the index.
5. Calls `respondToInteraction(id, selected, "discord:<userId>", metadata)`.
6. Transitions job back to `running`.

### Thread reply responses (bidirectional relay)

Handled by the runner's `BidirectionalRelay` (in `@almirant/remote-agent`):

1. Runner listens for Discord thread messages via `waitForThreadReply()`.
2. On reply, calls `workerClient.createInteraction()` or feeds the reply
   directly to the OpenCode session.
3. For interactions awaiting answers, the runner polls
   `GET /workers/jobs/:id/interactions/:interactionId`.

---

## Database schema

**Table**: `worker_interactions` (in `backend/packages/database/src/schema/worker-interactions.ts`)

Key columns:

- `question_type`: enum (clarification, approval, choice, free_text)
- `question_text`: the question
- `question_context`: JSONB arbitrary context
- `options`: JSONB string array (for choice questions)
- `answer_text`: the response text
- `answer_metadata`: JSONB (source info, custom_id, etc.)
- `answered_by`: user ID or `discord:<discordUserId>`
- `status`: enum (pending, answered, timed_out, cancelled)

---

## Conclusion

All required fields for Discord thread reply forwarding are already covered:

- **type** -> `questionType` (creation) or `status` (polling)
- **content** -> `questionText` (creation) / `answerText` (response)
- **userId** -> `answeredBy` (set on response, format: `discord:<id>`)
- **source** -> `answerMetadata.source` (e.g. `"discord_component"`)

The GET endpoint returns the full interaction including response data, which is
sufficient for polling.

No backend changes are needed.
