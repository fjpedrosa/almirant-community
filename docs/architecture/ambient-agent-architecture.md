# Environmental Agent Architecture

> A per-project ambient agent accessible via WhatsApp, Telegram, Discord, and Slack for conversational planning, seed capture, and project management.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Options](#architecture-options)
3. [Multi-Channel Connectors](#multi-channel-connectors)
4. [Identity Model](#identity-model)
5. [Conversation Flow and Context](#conversation-flow-and-context)
6. [Cost Estimation](#cost-estimation)
7. [Implementation Plan](#implementation-plan)
8. [Risks and Open Questions](#risks-and-open-questions)

---

## Executive Summary

The Environmental Agent ("Ambient Agent") provides conversational AI access to Almirant's project management capabilities across multiple messaging platforms. Unlike the existing Remote Agent (which runs full coding sessions in containers), the Ambient Agent is a lightweight, always-available assistant that:

- Captures seeds (ideas, feedback) through natural conversation
- Answers questions about project status, work items, and sprints
- Performs simple management actions (create tasks, move items, assign)
- Provides contextual project insights

**Recommendation**: Start with **Level 1 architecture** (single service + LLM API + MCP tools), deploying first on Discord and Telegram where we have existing infrastructure.

---

## Architecture Options

### Level 0: Commands Without LLM (Baseline)

**Current State in Telegram Bot**

The existing Telegram bot at `backend/api/src/lib/telegram/` implements 12+ commands:

| Command | Description |
|---------|-------------|
| `/help` | List available commands |
| `/status` | Organization/project overview |
| `/me` | Show linked user info |
| `/tasks` | List in-progress work items |
| `/boards` | List available boards |
| `/board <name>` | Show board summary |
| `/move <TASK_ID> <col>` | Move work item (with confirmation) |
| `/assign <TASK_ID> <user>` | Assign work item |
| `/create <type> <title>` | Create work item (wizard flow) |
| `/sprint` | Show active sprint |
| `/sprint close` | Close sprint (with confirmation) |
| `/search <text>` | Search work items |
| `/project <name>` | Set active project context |
| `/report` | Get sprint report link |

**Pros**:

- Zero marginal cost per interaction
- Instant response times
- Already implemented and battle-tested
- No rate limiting concerns

**Cons**:

- Rigid syntax requires user training
- No natural language understanding
- Cannot capture freeform ideas naturally
- Limited to predefined command set

**When to use**: Keep as fallback when LLM is unavailable or for power users who prefer deterministic commands.

---

### Level 1: Lightweight Service + LLM + MCP Tools (Recommended)

**Architecture**

```
+------------------+     +-------------------+     +----------------+
|  Channel Adapter |     |  Ambient Agent    |     |   Almirant     |
|  (Telegram, etc) | --> |  Service          | --> |   MCP Server   |
+------------------+     +-------------------+     +----------------+
                               |                         |
                               v                         v
                         +-----------+             +-----------+
                         | LLM API   |             | Database  |
                         | (Anthropic|             | (Drizzle) |
                         |  /OpenAI) |             +-----------+
                         +-----------+
```

**Components**:

1. **Ambient Agent Service** - Single Bun process handling all conversations
   - Routes messages from channel adapters
   - Manages conversation history (in-memory + DB backup)
   - Calls LLM with system prompt + tools
   - Executes tool calls via MCP client

2. **Channel Adapters** - Thin translation layer per platform
   - Reuse existing `ChannelAdapter` interface from `remote-agent`
   - Handle platform-specific message formats and limits
   - Manage threading/reply semantics

3. **MCP Tool Execution** - Direct HTTP calls to existing MCP endpoints
   - All 18 tool domains already available (see `backend/api/src/mcp/setup.ts`)
   - Project-scoped via `projectId` query param

**Existing MCP Tools Available**:

| Domain | Tools |
|--------|-------|
| Projects | `list_projects`, `get_project`, `create_project` |
| Boards | `list_boards`, `get_board` |
| Work Items | `list_work_items`, `get_work_item`, `create_work_item`, `update_work_item`, `move_work_item` |
| Seeds | `list_seeds`, `get_seed`, `create_seed`, `update_seed`, `promote_seed` |
| Sprints | `get_active_sprint`, `list_sprint_items`, `close_sprint` |
| Tags | `list_tags`, `create_tag`, `add_tag_to_*` |
| Milestones | `list_milestones`, `create_milestone` |
| Documents | `list_documents`, `get_document` |
| Members | `list_members` |
| Todos | `list_todos`, `create_todo` |
| Ideas | `list_ideas`, `create_idea` |
| Expenses | `list_expenses`, `create_expense` |
| Commits | `list_commits` |
| Auth | `get_user_context` |
| Quota | `check_quota`, `get_quota_status` |
| Skill Context | Context retrieval for AI |
| Dependencies | Work item dependency management |

**Pros**:

- Full natural language understanding
- Leverages all existing MCP tools
- Single deployment, easy to scale horizontally
- Can gracefully degrade to Level 0 commands
- Conversation context enables multi-turn interactions

**Cons**:

- LLM cost per message (dominant cost factor)
- Latency for LLM response (2-5 seconds typical)
- Context window limits for long conversations

**Estimated Complexity**: 2-3 weeks for core service + first channel

---

### Level 2: Persistent Container Per Client (Heavy)

**Architecture**

Extends the existing Remote Agent runner model:

```
+------------------+     +---------------+     +---------------------+
|  Channel Adapter | --> |  Job Queue    | --> |  Container Pool     |
+------------------+     +---------------+     +---------------------+
                                                      |
                                              +---------------+
                                              | Claude Code   |
                                              | with repo     |
                                              | access        |
                                              +---------------+
```

**Components**:

1. **Container Pool** - Pre-warmed containers per project
2. **Claude Code Runtime** - Full coding agent with repo access
3. **Bidirectional Session** - Already implemented in `remote-agent` package

**When Level 2 Makes Sense**:

- User wants actual code changes through chat
- Complex analysis requiring repository inspection
- Multi-file refactoring operations
- Integration with CI/CD pipelines

**Pros**:

- Full coding capabilities
- Repository access for deep context
- Can execute shell commands and tests

**Cons**:

- High infrastructure cost ($0.02-0.05/hour per warm container)
- Complex state management across chat sessions
- Cold start latency (30-60 seconds)
- Security considerations for multi-tenant code access

**Recommendation**: Defer Level 2 until Level 1 proves demand. Level 1 can create work items that trigger existing Remote Agent runs.

---

## Multi-Channel Connectors

### Existing Infrastructure

#### Discord Adapter (`backend/packages/remote-agent/src/channels/discord/`)

Full implementation with:

- Thread management (`thread-manager.ts`)
- Message splitting for 2000-char limit (`formatter.ts`)
- Bidirectional polling for user replies (`bidirectional.ts`)
- Rate limit handling with retry
- Embed and button support

**Reuse Strategy**: Direct import. Add ambient message handler alongside existing `/agent` command handler.

#### Web Adapter (`backend/packages/remote-agent/src/channels/web/`)

WebSocket-based adapter for frontend planning sessions:

- Broadcasts to frontend via `wsConnectionManager`
- No persistent history (ephemeral sessions)

**Reuse Strategy**: Adapt for ambient chat widget in dashboard.

#### Telegram Bot (`backend/api/src/lib/telegram/`)

Comprehensive command router with:

- User identity via `telegram_users` table
- Callback queries with inline keyboards
- Notification delivery system
- Rate limiting per chat

**Reuse Strategy**: Add LLM conversation handler alongside commands. When message doesn't start with `/`, route to ambient agent.

### New Channels Required

#### WhatsApp Business API

**Integration Points**:

- Cloud API (hosted by Meta) vs On-Premises API
- Recommend Cloud API for lower ops burden

**Technical Requirements**:

```typescript
interface WhatsAppAdapter extends ChannelAdapter {
  // WhatsApp-specific extensions
  sendTemplate: (phoneNumber: string, templateName: string, params: Record<string, string>) => Promise<void>;
  markAsRead: (messageId: string) => Promise<void>;
}
```

**24-Hour Session Window**:

- User-initiated messages open 24h "customer service window"
- After window expires, only approved templates allowed
- Business-initiated conversations require template approval

**Webhook Handling**:

```
POST /webhooks/whatsapp
  -> Verify signature (X-Hub-Signature-256)
  -> Parse message type (text, interactive, template_status)
  -> Route to ambient agent or command handler
  -> Return 200 immediately (async processing)
```

**Cost Considerations** (Meta pricing, varies by region):

| Conversation Type | Price (USD) |
|------------------|-------------|
| Marketing | $0.025-0.15 |
| Utility | $0.015-0.10 |
| Service | $0.005-0.06 |
| User-initiated | Free first 1000/mo |

#### Slack

**Integration Approach**:

- Slack App with Bot Token + Events API
- Socket Mode for easier local development

**Required Scopes**:

```
chat:write
channels:history
groups:history
im:history
users:read
app_mentions:read
```

**Event Subscriptions**:

- `message.im` - Direct messages to bot
- `app_mention` - @mentions in channels
- `message.channels` - For channel participation (optional)

**Implementation**:

```typescript
interface SlackAdapter extends ChannelAdapter {
  // Slack uses channel_id + thread_ts for threading
  replyInThread: (channelId: string, threadTs: string, text: string) => Promise<SlackMessage>;
  // Block Kit support
  sendBlocks: (channelId: string, blocks: Block[]) => Promise<SlackMessage>;
}
```

### ChannelAdapter Interface (Existing)

From `backend/packages/remote-agent/src/core/types.ts`:

```typescript
export type ChannelAdapter = {
  sendMessage: (threadId: string, content: string) => Promise<ChannelMessage>;
  editMessage: (threadId: string, messageId: string, content: string) => Promise<ChannelMessage>;
  createThread: (args: {
    channelId: string;
    name: string;
    reason?: string;
    autoArchiveDurationMinutes?: 60 | 1440 | 4320 | 10080;
  }) => Promise<ChannelThread>;
  renameThread: (threadId: string, name: string) => Promise<ChannelThread>;
  archiveThread: (threadId: string) => Promise<void>;
  addReaction: (threadId: string, messageId: string, emoji: string) => Promise<void>;
};
```

**Extension for Ambient Agent**:

```typescript
export type AmbientChannelAdapter = ChannelAdapter & {
  // Receive messages (webhook or polling)
  onMessage: (handler: (msg: IncomingMessage) => Promise<void>) => void;
  // Platform-specific identity
  getUserIdentifier: (msg: IncomingMessage) => string;
  // Optional: typing indicators
  sendTypingIndicator?: (threadId: string) => Promise<void>;
};
```

---

## Identity Model

### Current Telegram Flow

1. **User generates link code** in Almirant settings
   - Creates `telegram_link_codes` row with SHA-256 hash
   - Code expires in 10 minutes

2. **User sends `/start <code>` to bot**
   - Bot validates code hash against `telegram_link_codes`
   - Creates `telegram_users` row linking `chat_id` to `user_id`

3. **Subsequent messages**
   - Look up `telegram_users` by `chat_id`
   - Derive `user_id` and associated organizations/projects

### Generalized Identity Schema

```sql
-- Channel-agnostic user linking
CREATE TABLE channel_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL, -- 'telegram', 'discord', 'whatsapp', 'slack'
  channel_user_id TEXT NOT NULL, -- platform-specific ID
  channel_metadata JSONB DEFAULT '{}', -- platform-specific data
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(channel_type, channel_user_id)
);

CREATE INDEX channel_users_user_id_idx ON channel_users(user_id);
CREATE INDEX channel_users_lookup_idx ON channel_users(channel_type, channel_user_id);
```

**Migration Path**:

- Keep existing `telegram_users` table
- Add new `channel_users` for WhatsApp/Slack
- Or migrate `telegram_users` data to `channel_users`

### Project Context Resolution

```typescript
type AmbientContext = {
  userId: string;
  organizationId: string;
  // Resolved from recent activity or explicit selection
  defaultProjectId?: string;
  // Channel-specific
  channelType: 'telegram' | 'discord' | 'whatsapp' | 'slack';
  threadId: string;
};

const resolveContext = async (
  channelType: string,
  channelUserId: string,
  threadId: string
): Promise<AmbientContext | null> => {
  // 1. Look up channel_users
  const channelUser = await getChannelUser(channelType, channelUserId);
  if (!channelUser) return null;

  // 2. Get user's organizations
  const orgs = await getUserOrganizations(channelUser.userId);
  if (orgs.length === 0) return null;

  // 3. Resolve default project (could be sticky per thread)
  const defaultProject = await getThreadProject(threadId)
    ?? await getMostRecentProject(channelUser.userId);

  return {
    userId: channelUser.userId,
    organizationId: orgs[0].id, // or prompt if multiple
    defaultProjectId: defaultProject?.id,
    channelType,
    threadId,
  };
};
```

---

## Conversation Flow and Context

### System Prompt Template

```markdown
You are the Almirant Ambient Agent, an AI assistant helping with project management.

## Your Capabilities
- Capture ideas and feedback as "seeds" for future work
- Create work items (tasks, stories, features, epics)
- Check project status, sprint progress, and work item details
- Move items between columns, assign to team members
- Answer questions about the project

## Current Context
- User: {{userName}} ({{userEmail}})
- Organization: {{organizationName}}
- Active Project: {{projectName}} ({{projectId}})
- Current Sprint: {{sprintName}} ({{sprintProgress}})

## Guidelines
1. Be concise - this is a chat interface, not a document
2. When capturing ideas, confirm what you understood
3. For ambiguous requests, ask clarifying questions
4. Use the tools available - don't make up information
5. If a task seems complex (code changes), suggest creating a work item for the Remote Agent

## Available Tools
{{toolList}}
```

### Conversation State Machine

```
           ┌─────────────────────┐
           │      IDLE           │
           │ (awaiting message)  │
           └──────────┬──────────┘
                      │ user message
                      v
           ┌─────────────────────┐
           │    PROCESSING       │
           │ (calling LLM)       │
           └──────────┬──────────┘
                      │
          ┌───────────┴───────────┐
          │                       │
          v                       v
  ┌──────────────┐      ┌───────────────────┐
  │ TOOL_CALLING │      │   RESPONDING      │
  │ (MCP calls)  │      │  (text response)  │
  └──────┬───────┘      └────────┬──────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     v
           ┌─────────────────────┐
           │  AWAITING_CONFIRM   │◄──── Optional for destructive actions
           │  (inline buttons)   │
           └──────────┬──────────┘
                      │
                      v
           ┌─────────────────────┐
           │      IDLE           │
           └─────────────────────┘
```

### Context Window Management

**Problem**: Long conversations exhaust context window (128K-200K tokens typical).

**Strategies**:

1. **Rolling Window**: Keep last N messages + system prompt + tool results

   ```typescript
   const MAX_HISTORY_MESSAGES = 20;
   const trimHistory = (messages: Message[]): Message[] => {
     if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
     return messages.slice(-MAX_HISTORY_MESSAGES);
   };
   ```

2. **Summarization**: Periodically compress old context

   ```typescript
   const shouldSummarize = (messages: Message[]): boolean => {
     const tokenCount = estimateTokens(messages);
     return tokenCount > 50_000;
   };

   const summarizeContext = async (messages: Message[]): Promise<string> => {
     // Use faster/cheaper model for summarization
     return await llm.complete({
       model: 'claude-3-haiku',
       prompt: `Summarize this conversation, preserving key decisions and context:\n${formatMessages(messages)}`,
     });
   };
   ```

3. **Session Boundaries**: New thread = new conversation
   - Clear on thread creation
   - Offer "recap" command for context

---

## Cost Estimation

### LLM Costs (Dominant Factor)

Based on March 2026 pricing:

| Model | Input ($/1M) | Output ($/1M) | Typical Turn |
|-------|-------------|---------------|--------------|
| Claude 3.5 Sonnet | $3.00 | $15.00 | $0.008 |
| Claude 3 Haiku | $0.25 | $1.25 | $0.001 |
| GPT-4o | $2.50 | $10.00 | $0.006 |
| GPT-4o-mini | $0.15 | $0.60 | $0.0004 |

**Assumptions per turn**:

- Input: 2,000 tokens (system prompt + history + user message)
- Output: 500 tokens (response + tool calls)

**Monthly Cost by Scale** (assuming 10 turns/user/day average):

| Clients | Daily Turns | Monthly Turns | Haiku Cost | Sonnet Cost |
|---------|-------------|---------------|------------|-------------|
| 10 | 100 | 3,000 | $3 | $24 |
| 100 | 1,000 | 30,000 | $30 | $240 |
| 1,000 | 10,000 | 300,000 | $300 | $2,400 |

**Cost Optimization Strategies**:

1. Use Haiku for simple queries (status checks, seed capture)
2. Route complex queries to Sonnet
3. Cache common responses (sprint status, project overview)
4. Rate limit free tier users

### Infrastructure Costs

**Level 1 (Recommended)**:

| Component | Specification | Monthly Cost |
|-----------|--------------|--------------|
| Ambient Agent Service | 1 vCPU, 1GB RAM | $10-15 |
| Database (shared) | Already provisioned | $0 |
| Redis (conversation cache) | 256MB | $5-10 |
| **Total** | | **$15-25** |

**Level 2 (Future)**:

| Component | Specification | Monthly Cost |
|-----------|--------------|--------------|
| Container Pool (5 warm) | 0.5 vCPU, 512MB each | $50-75 |
| Container Manager | 0.5 vCPU | $10 |
| Storage (repos) | 100GB SSD | $10 |
| **Total** | | **$70-95** |

### Channel-Specific Costs

**WhatsApp Business API**:

- Platform fee: $0 (Cloud API)
- Conversation charges: ~$0.01-0.05 per conversation window
- Estimated 100 clients x 30 days x $0.02 = **$60/month**

**Discord/Telegram/Slack**: Free

### Total Cost Projections

| Scale | LLM (Haiku) | Infra | WhatsApp | Total |
|-------|-------------|-------|----------|-------|
| 10 clients | $3 | $20 | $6 | **$29/mo** |
| 100 clients | $30 | $25 | $60 | **$115/mo** |
| 1,000 clients | $300 | $50 | $600 | **$950/mo** |

---

## Implementation Plan

### Phase 1: Level 1 MVP (Weeks 1-3)

**Goal**: Ambient agent working on Discord + Telegram

**Week 1: Core Service**

- [ ] Create `backend/api/src/lib/ambient-agent/` module
- [ ] Implement conversation state manager
- [ ] LLM client wrapper with tool calling
- [ ] MCP tool executor (reuse existing tools)

**Week 2: Discord Integration**

- [ ] Add ambient handler to Discord interactions
- [ ] Implement DM conversation flow
- [ ] Thread-per-conversation in guild channels
- [ ] Test with internal team

**Week 3: Telegram Integration**

- [ ] Add LLM fallback to command router
- [ ] Conversation history via `ai_conversations` table
- [ ] User feedback collection

**Deliverables**:

- `/ambient` command on Discord
- Natural language in Telegram DMs
- Seed capture and work item creation
- Status queries

### Phase 2: WhatsApp + Slack (Weeks 4-6)

**Week 4: WhatsApp Setup**

- [ ] Meta Business verification
- [ ] Template message approval
- [ ] Webhook endpoint
- [ ] WhatsApp adapter implementation

**Week 5: Slack Setup**

- [ ] Slack App creation
- [ ] OAuth flow for workspace install
- [ ] Slack adapter implementation

**Week 6: Testing & Polish**

- [ ] Cross-channel identity linking
- [ ] Notification preferences per channel
- [ ] Error handling and fallbacks

### Phase 3: Advanced Features (Weeks 7-9)

- [ ] Project/board context switching mid-conversation
- [ ] Rich message formatting per platform
- [ ] Conversation summarization
- [ ] Analytics dashboard (messages/user, tool usage)
- [ ] Rate limiting and abuse prevention

### Phase 4: Level 2 Evaluation (Week 10+)

- [ ] Usage analysis: do users need code access?
- [ ] If yes: container pool integration
- [ ] "Escalate to Remote Agent" flow

---

## Risks and Open Questions

### Technical Risks

1. **Context Window Exhaustion**
   - Mitigation: Rolling window + summarization
   - Open question: Optimal window size per use case

2. **Rate Limiting Across Channels**
   - Different limits: Discord (5/5s), Telegram (30/s), WhatsApp (tier-based)
   - Mitigation: Per-channel queues with backpressure

3. **LLM Reliability**
   - Provider outages affect all users
   - Mitigation: Fallback to Level 0 commands + cached responses

4. **Tool Call Failures**
   - MCP server errors, database timeouts
   - Mitigation: Graceful error messages, retry logic

### Business Risks

1. **LLM Cost Overruns**
   - Chatty users could exceed projections
   - Mitigation: Per-user rate limits, usage alerts

2. **WhatsApp Template Approval**
   - Meta review can take days
   - Mitigation: Start approval process early

### Open Questions

1. **Multi-project in single conversation**
   - Allow switching? Always confirm project context?
   - Recommendation: Explicit `/project <name>` command + confirmation

2. **Conversation persistence**
   - How long to retain? GDPR implications?
   - Recommendation: 90-day retention, user-deletable

3. **Team vs Personal context**
   - Can user see all org work items or just assigned?
   - Recommendation: Full org visibility, matching web UI

4. **Notification integration**
   - Should ambient agent handle existing notification flows?
   - Recommendation: Separate notification system, ambient is for queries

5. **Voice messages**
   - WhatsApp/Telegram support voice
   - Recommendation: Phase 4 feature, requires Whisper integration

---

## Appendix: File Locations

### Existing Code to Reuse

| Component | Path |
|-----------|------|
| ChannelAdapter interface | `backend/packages/remote-agent/src/core/types.ts` |
| Discord adapter | `backend/packages/remote-agent/src/channels/discord/` |
| Web adapter | `backend/packages/remote-agent/src/channels/web/` |
| Telegram commands | `backend/api/src/lib/telegram/` |
| Telegram user schema | `backend/packages/database/src/schema/telegram.ts` |
| MCP tools setup | `backend/api/src/mcp/setup.ts` |
| AI conversations table | `backend/packages/database/src/schema/ai-conversations.ts` |

### New Code Locations

| Component | Proposed Path |
|-----------|---------------|
| Ambient Agent service | `backend/api/src/lib/ambient-agent/` |
| WhatsApp adapter | `backend/packages/remote-agent/src/channels/whatsapp/` |
| Slack adapter | `backend/packages/remote-agent/src/channels/slack/` |
| Channel users schema | `backend/packages/database/src/schema/channel-users.ts` |
| Ambient routes | `backend/api/src/routes/ambient.routes.ts` |

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-03-15 | Ambient Agent Research | Initial architecture document |
