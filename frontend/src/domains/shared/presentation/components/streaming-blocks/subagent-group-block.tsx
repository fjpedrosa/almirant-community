import { useState, useEffect, useRef } from 'react';
import { Bot, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getToolNameColor, humanizeToolName, parseMcpToolName, getToolServerColor } from './tool-icon';
import { ToolIcon } from './tool-icon';
import { McpIcon } from '@/components/icons/mcp-icon';

interface NestedToolCall {
  toolName: string;
  toolCallId: string;
  status: 'pending' | 'success' | 'error';
  description?: string;
  filePath?: string;
  command?: string;
  inputPreview?: string;
}

interface SubagentEntry {
  subagentId: string;
  description: string;
  isBackground: boolean;
  status: 'running' | 'done';
  subagentType?: string;
  nestedToolCalls: NestedToolCall[];
}

interface SubagentGroupBlockProps {
  subagents: SubagentEntry[];
}

/** Format "frontend-developer" → "Frontend Developer" */
const formatAgentType = (raw?: string): string => {
  if (!raw) return 'Agent';
  return raw
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

/** Human-readable count label per tool type. */
const humanizeToolCount = (toolName: string, count: number): string => {
  const n = count;
  if (toolName === 'Read') return `${n} file${n > 1 ? 's' : ''} read`;
  if (toolName === 'Glob') return `${n} file search${n > 1 ? 'es' : ''}`;
  if (toolName === 'Grep') return `${n} content search${n > 1 ? 'es' : ''}`;
  if (toolName === 'Write') return `${n} file${n > 1 ? 's' : ''} written`;
  if (toolName === 'Edit') return `${n} edit${n > 1 ? 's' : ''}`;
  if (toolName === 'Git') return `${n} git action${n > 1 ? 's' : ''}`;
  if (toolName === 'GitHub') return `${n} GitHub action${n > 1 ? 's' : ''}`;
  if (toolName.includes('create_task')) return `${n} task${n > 1 ? 's' : ''} created`;
  if (toolName.includes('create_feature')) return `${n} feature${n > 1 ? 's' : ''}`;
  if (toolName.includes('create_epic')) return `${n} epic${n > 1 ? 's' : ''}`;
  if (toolName.includes('create_story')) return `${n} stor${n > 1 ? 'ies' : 'y'}`;
  return `${n} call${n > 1 ? 's' : ''}`;
};

/** Stable color palette for subagents — deterministic by subagentType or id. */
const AGENT_COLORS = [
  'text-blue-400',
  'text-violet-400',
  'text-amber-400',
  'text-cyan-400',
  'text-rose-400',
  'text-emerald-400',
  'text-orange-400',
  'text-pink-400',
] as const;

const getAgentColor = (agent: SubagentEntry): string => {
  const key = agent.subagentType ?? agent.subagentId ?? '';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
};

/** Group tool calls by toolName for summary display. */
const summarizeToolCalls = (tools: NestedToolCall[]): { name: string; count: number; toolName: string }[] => {
  const counts = new Map<string, number>();
  for (const t of tools) {
    counts.set(t.toolName, (counts.get(t.toolName) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([toolName, count]) => ({
    name: humanizeToolName(toolName),
    count,
    toolName,
  }));
};

/** Collapsible subagent with its nested tool calls. */
const SubagentRow: React.FC<{
  agent: SubagentEntry;
  isLast: boolean;
  agentColor: string;
}> = ({ agent, isLast, agentColor }) => {
  const [expanded, setExpanded] = useState(false);
  const isRunning = agent.status === 'running';
  const typeLabel = formatAgentType(agent.subagentType);
  const label = agent.description || typeLabel;
  const toolSummary = !isRunning ? summarizeToolCalls(agent.nestedToolCalls) : [];
  const hasTools = agent.nestedToolCalls.length > 0;

  // Active (pending) tools — only shown while running
  const activeTools = isRunning
    ? agent.nestedToolCalls.filter((t) => t.status === 'pending')
    : [];
  const lastTool = activeTools.length === 0 && isRunning && agent.nestedToolCalls.length > 0
    ? agent.nestedToolCalls[agent.nestedToolCalls.length - 1]
    : null;

  return (
    <div className="relative ml-6">
      {/* Vertical line */}
      <div className={cn('absolute left-0 top-0 w-px bg-muted-foreground/60', isLast ? 'h-3.5' : 'bottom-0')} />
      {/* Horizontal branch */}
      <div className="absolute left-0 top-3.5 w-4 h-px bg-muted-foreground/60" />
      {/* Agent name line */}
      <div className={cn('flex items-center gap-2 py-0.5 pl-5')}>
        <Bot className={cn('size-4 flex-shrink-0', agentColor)} />
        {agent.subagentType && (
          <span className={cn('text-sm font-semibold uppercase tracking-wide whitespace-nowrap', agentColor, isRunning && 'animate-agent-color-shift motion-reduce:animate-none')}>
            {typeLabel}
          </span>
        )}
        <span className={cn('text-sm truncate', isRunning ? 'text-muted-foreground' : 'text-foreground/70')}>
          {label}
        </span>
        {agent.isBackground && (
          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            bg
          </span>
        )}
        {!isRunning && <Check className={cn('size-4 flex-shrink-0', agentColor)} />}
        {isRunning && <Loader2 className="size-3.5 text-primary animate-spin flex-shrink-0" />}
      </div>

      {/* Tool summary line below agent name — clickable to expand */}
      {!isRunning && hasTools && (
        <div
          className="flex items-center gap-1.5 py-1.5 pl-6 cursor-pointer hover:bg-muted/30 rounded min-h-[32px]"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? <ChevronDown className="size-3.5 text-foreground/60 flex-shrink-0" />
            : <ChevronRight className="size-3.5 text-foreground/60 flex-shrink-0" />
          }
          {toolSummary.map((s) => {
            const mcp = parseMcpToolName(s.toolName);
            const color = mcp ? getToolServerColor(mcp.serverRaw) : getToolNameColor(s.toolName);
            return (
              <span key={s.toolName} className="inline-flex items-center gap-0.5">
                {mcp ? (
                  <McpIcon className={cn('size-3.5', color)} />
                ) : (
                  <ToolIcon toolName={s.toolName} className={cn('size-3.5', color)} />
                )}
                <span className="text-xs text-foreground/70">{s.count}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Running: show active or last tool */}
      {isRunning && activeTools.length > 0 && activeTools.map((tool) => (
        <ToolLine key={tool.toolCallId} tool={tool} isActive />
      ))}
      {isRunning && lastTool && activeTools.length === 0 && (
        <ToolLine tool={lastTool} isActive />
      )}

      {/* Done + expanded: show tool groups by type, each collapsible */}
      {!isRunning && expanded && (
        <ToolGroupList tools={agent.nestedToolCalls} />
      )}
    </div>
  );
};

/** Single tool call line in the tree. */
const ToolLine: React.FC<{
  tool: NestedToolCall;
  isActive: boolean;
  isLast?: boolean;
}> = ({ tool, isActive, isLast = true }) => {
  const mcpParts = parseMcpToolName(tool.toolName);
  const displayName = humanizeToolName(tool.toolName);
  const nameColor = mcpParts ? getToolServerColor(mcpParts.serverRaw) : getToolNameColor(tool.toolName);
  let detail = tool.filePath ?? tool.command ?? tool.description ?? tool.inputPreview;
  if (detail) detail = detail.replace(/\/workspace\/repo\//g, '');

  return (
    <div className="relative ml-6">
      {/* Vertical: full height for non-last, half height for last */}
      <div className={cn('absolute left-0 top-0 w-px bg-muted-foreground/60', isLast ? 'h-3' : 'bottom-0')} />
      <div className="absolute left-0 top-3 w-4 h-px bg-muted-foreground/60" />
      <div className={cn(
        'flex items-center gap-1.5 py-0.5 pl-5',
        isActive && 'animate-pulse motion-reduce:animate-none',
      )}>
      {mcpParts ? (
        <McpIcon className={cn('size-4 flex-shrink-0', nameColor)} />
      ) : (
        <ToolIcon toolName={tool.toolName} className={cn('size-4 flex-shrink-0', nameColor)} />
      )}
      {mcpParts ? (
        <>
          <span className={cn('font-sans text-sm font-semibold whitespace-nowrap', nameColor)}>
            {mcpParts.serverLabel}
          </span>
          <span className="text-foreground/50 text-sm font-sans whitespace-nowrap">
            {mcpParts.actionLabel}
          </span>
        </>
      ) : (
        <span className={cn('font-sans text-sm font-medium whitespace-nowrap', nameColor)}>
          {displayName}
        </span>
      )}
      {detail && (
        <span className={cn('truncate text-sm font-sans', isActive ? 'text-foreground/50' : 'text-foreground/70')}>
          {detail}
        </span>
      )}
        {isActive && <Loader2 className="size-3 text-muted-foreground/40 flex-shrink-0 animate-spin" />}
        {!isActive && tool.status === 'success' && <Check className="size-3 text-green-500/60 flex-shrink-0" />}
      </div>
    </div>
  );
};

/** Groups tools by type, each collapsible to show individual calls. */
const ToolGroupList: React.FC<{ tools: NestedToolCall[] }> = ({ tools }) => {
  const groups: Array<{ toolName: string; items: NestedToolCall[] }> = [];
  const groupMap = new Map<string, NestedToolCall[]>();
  for (const t of tools) {
    let items = groupMap.get(t.toolName);
    if (!items) {
      items = [];
      groupMap.set(t.toolName, items);
      groups.push({ toolName: t.toolName, items });
    }
    items.push(t);
  }

  return (
    <div className="ml-2">
      {groups.map((group, gIdx) => (
        <ToolGroupRow
          key={group.toolName}
          group={group}
          isLast={gIdx === groups.length - 1}
        />
      ))}
    </div>
  );
};

/** A single tool type group — e.g. "Read 63" — click to expand individual calls. */
const ToolGroupRow: React.FC<{
  group: { toolName: string; items: NestedToolCall[] };
  isLast: boolean;
}> = ({ group, isLast }) => {
  const [expanded, setExpanded] = useState(false);
  const mcpParts = parseMcpToolName(group.toolName);
  const nameColor = mcpParts ? getToolServerColor(mcpParts.serverRaw) : getToolNameColor(group.toolName);
  const displayName = humanizeToolName(group.toolName);

  return (
    <div className="relative ml-6">
      <div className={cn('absolute left-0 top-0 w-px bg-muted-foreground/60', isLast ? 'h-3.5' : 'bottom-0')} />
      <div className="absolute left-0 top-3 w-4 h-px bg-muted-foreground/60" />
      <div
        className="flex items-center gap-1.5 py-1.5 pl-5 cursor-pointer hover:bg-muted/30 rounded min-h-[32px]"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown className="size-3.5 text-foreground/60 flex-shrink-0" />
          : <ChevronRight className="size-3.5 text-foreground/60 flex-shrink-0" />
        }
        {mcpParts ? (
          <McpIcon className={cn('size-4 flex-shrink-0', nameColor)} />
        ) : (
          <ToolIcon toolName={group.toolName} className={cn('size-4 flex-shrink-0', nameColor)} />
        )}
        {mcpParts ? (
          <>
            <span className={cn('font-sans text-sm font-semibold whitespace-nowrap', nameColor)}>
              {mcpParts.serverLabel}
            </span>
            <span className="text-foreground/50 text-sm font-sans whitespace-nowrap">
              {mcpParts.actionLabel}
            </span>
          </>
        ) : (
          <span className={cn('font-sans text-sm font-medium whitespace-nowrap', nameColor)}>
            {displayName}
          </span>
        )}
        <span className="text-sm text-foreground/70">
          {humanizeToolCount(group.toolName, group.items.length)}
        </span>
      </div>
      {expanded && group.items.map((tool, idx) => (
        <ToolLine
          key={tool.toolCallId}
          tool={tool}
          isActive={false}
          isLast={idx === group.items.length - 1}
        />
      ))}
    </div>
  );
};

export const SubagentGroupBlock: React.FC<SubagentGroupBlockProps> = ({ subagents }) => {
  const runningCount = subagents.filter((s) => s.status === 'running').length;
  const allDone = runningCount === 0;

  // Build header with agent type names when available
  const runningAgents = subagents.filter((s) => s.status === 'running');
  const runningTypeNames = runningAgents
    .map((a) => formatAgentType(a.subagentType))
    .filter((t) => t !== 'Agent');
  const headerLabel = allDone
    ? `${subagents.length} agent${subagents.length > 1 ? 's' : ''} completed`
    : runningTypeNames.length > 0
      ? `Running ${runningTypeNames.join(', ')}...`
      : `Running ${runningCount} agent${runningCount > 1 ? 's' : ''}...`;

  // Elapsed time timer - only runs while agents are running
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (allDone) return;
    const now = Date.now();
    startRef.current = now;
    // Use setTimeout to defer the initial setState to avoid synchronous call in effect
    const initTimer = setTimeout(() => setElapsed(0), 0);
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [allDone]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, '0')}s`
    : `${seconds}s`;

  return (
    <div className="py-1 px-1">
      <div className={cn(
        'flex items-center gap-2 text-sm font-medium',
        allDone ? 'text-foreground/70' : 'text-muted-foreground',
      )}>
        <Bot className={cn('size-4 flex-shrink-0', !allDone && 'animate-pulse motion-reduce:animate-none text-primary')} />
        <span>{headerLabel}</span>
        {!allDone && (
          <span className="text-xs text-muted-foreground/60 tabular-nums">{timeStr}</span>
        )}
      </div>

      {subagents.map((agent, idx) => (
        <SubagentRow
          key={agent.subagentId}
          agent={agent}
          isLast={idx === subagents.length - 1}
          agentColor={getAgentColor(agent)}
        />
      ))}
    </div>
  );
};
