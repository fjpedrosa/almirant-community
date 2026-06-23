import { useState } from "react";
import cronstrue from "cronstrue";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SlashAutocompleteTextarea } from "@/components/ui/slash-autocomplete-textarea";
import {
  CalendarDays,
  Check,
  ChevronsUpDown,
  Clock,
  Copy,
  GitBranch,
  HelpCircle,
  Hourglass,
  ListChecks,
  ShieldCheck,
  Settings2,
  Sparkles,
  Sun,
  Timer,
  Webhook,
  Workflow,
  X,
} from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { AnthropicIcon } from "@/components/icons/anthropic-icon";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OpenAIIcon } from "@/components/icons/openai-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { ZAIIcon } from "@/components/icons/zai-icon";
import { SkillSourceBadge } from "@/domains/skills/presentation/components/skill-source-badge";
import type { AgentFormDrawerProps, AIProvider, CodingAgent } from "../../domain/types";
import {
  PROVIDER_OPTIONS,
  DAY_OF_WEEK_OPTIONS,
  CODING_AGENT_OPTIONS,
  HOUR_OPTIONS,
  TIMEZONE_OPTIONS,
  DAY_PRESETS,
  BUILTIN_AUTOMATIONS,
  type BuiltinAutomationId,
} from "../../domain/types";
import {
  GUIDED_CRON_INTERVAL_OPTIONS,
  GUIDED_CRON_MINUTE_OPTIONS,
  buildCronExpression,
  parseGuidedCronExpression,
} from "../../domain/cron-builder";
import { resolveCronFormActiveMode } from "./cron-form-defaults";

// Helper to get human-readable cron description
const getCronDescription = (expression: string): string | null => {
  if (!expression?.trim()) return null;
  try {
    return cronstrue.toString(expression);
  } catch {
    return null;
  }
};

const getCodingAgentIcon = (value: string) => {
  switch (value) {
    case "claude-code":
      return <ClaudeIcon className="size-5" />;
    case "codex":
    case "codex-cli":
      return <CodexIcon className="size-5" />;
    case "opencode":
      return <OpenCodeIcon className="size-5" />;
    case "zai":
    case "zipu":
      return <ZAIIcon className="size-5" />;
    case "grok":
      return <XAIIcon className="size-5" />;
    default:
      return null;
  }
};

const getProviderIcon = (value: AIProvider) => {
  switch (value) {
    case "anthropic":
      return <AnthropicIcon className="size-5" />;
    case "openai":
      return <OpenAIIcon className="size-5" />;
    case "zai":
      return <ZAIIcon className="size-5" />;
    case "xai":
      return <XAIIcon className="size-5" />;
    default:
      return null;
  }
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  "claude-code": "Anthropic CLI runtime — best for nuanced edits and long context.",
  codex: "OpenAI Codex CLI — fast, predictable for greenfield code.",
  zipu: "z.ai (GLM) via the Anthropic-compatible endpoint.",
  grok: "xAI provider using Grok models, executed by the selected coding runtime.",
};

const CODING_AGENT_DESCRIPTIONS: Record<CodingAgent, string> = {
  "claude-code": "Anthropic Claude family.",
  codex: "OpenAI GPT family via Codex CLI.",
  opencode: "z.ai GLM models via OpenCode.",
};

const PROVIDER_LABEL_BY_VALUE: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  zai: "z.ai",
  xai: "xAI",
};

const DEFAULT_GUIDED_CRON = {
  interval: { mode: "interval" as const, intervalMinutes: 15 },
  hourly: { mode: "hourly" as const },
  daily: { mode: "daily" as const, hour: 9, minute: 0 },
  weekly: {
    mode: "weekly" as const,
    daysOfWeek: [...DAY_PRESETS.weekdays],
    hour: 9,
    minute: 0,
  },
};

const NO_PROJECT_VALUE = "__no_project__";

type WizardStep = "kind" | "details" | "schedule";

interface SelectableCardProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  rightSlot?: React.ReactNode;
  disabled?: boolean;
  compact?: boolean;
}

const SelectableCard = ({
  selected,
  onClick,
  icon,
  title,
  description,
  rightSlot,
  disabled = false,
  compact = false,
}: SelectableCardProps) => {
  const iconWrapperCls = cn(
    "rounded-lg p-2 shrink-0",
    selected ? "bg-primary/15 text-primary" : "bg-muted text-foreground",
  );

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "min-h-20" : "min-h-24",
        disabled
          ? "opacity-60 cursor-not-allowed"
          : selected
            ? "border-primary bg-primary/5 cursor-pointer"
            : "bg-background hover:bg-muted/50 cursor-pointer",
      )}
    >
      {compact ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className={iconWrapperCls}>{icon}</div>
            <p className="min-w-0 flex-1 font-medium leading-tight truncate">{title}</p>
            {rightSlot}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className={iconWrapperCls}>{icon}</div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium leading-tight">{title}</p>
              {rightSlot}
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      )}
    </button>
  );
};

const STEP_CONFIG: { id: WizardStep; label: string; icon: React.ReactNode }[] = [
  { id: "kind", label: "Type", icon: <Sparkles className="size-3.5" /> },
  { id: "details", label: "Details", icon: <Settings2 className="size-3.5" /> },
  { id: "schedule", label: "Schedule", icon: <Clock className="size-3.5" /> },
];

const StepIndicator = ({ currentStep }: { currentStep: WizardStep }) => {
  const currentIndex = STEP_CONFIG.findIndex((s) => s.id === currentStep);
  return (
    <div className="flex items-center gap-2">
      {STEP_CONFIG.map((step, index) => {
        const active = index === currentIndex;
        const done = index < currentIndex;
        return (
          <div key={step.id} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                active && "bg-primary text-primary-foreground",
                done && "bg-primary/10 text-primary",
                !active && !done && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : step.icon}
              {step.label}
            </span>
            {index < STEP_CONFIG.length - 1 && (
              <span
                className={cn(
                  "h-px w-6 bg-border",
                  done && "bg-primary/40",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export const AgentFormDrawer = ({
  open,
  onOpenChange,
  isEditing,
  isPending,
  form,
  onSubmit,
  skills,
  userSkills,
  projects,
  scheduleType,
  trigger,
  availableProviders,
  availableModels,
  availableReasoningLevels,
  agentKind,
  automationTargetKind,
  builtinAutomationId,
  automationSkillSlug,
  automationProjectIds,
  backlogDrainEnabled,
  backlogDrainWorkItems,
  isLoadingBacklogDrainWorkItems,
  backlogDrainPreview,
  isLoadingBacklogDrainPreview,
  webhookProposal,
  isLoadingWebhookProposal,
}: AgentFormDrawerProps) => {
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [projectScopeOpen, setProjectScopeOpen] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState<WizardStep>(() => (isEditing ? "details" : "kind"));
  const isWebhookTrigger = trigger === "webhook";
  const isManualSchedule = scheduleType === "manual";

  const webhookUrl = (form.watch("webhookUrl") ?? webhookProposal?.webhookUrl ?? "") as string;
  const testWebhookUrl = (form.watch("testWebhookUrl") ?? webhookProposal?.testWebhookUrl ?? "") as string;

  const handleCopyWebhookUrl = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedWebhookUrl(value);
      setTimeout(() => setCopiedWebhookUrl(null), 2000);
    } catch {
      // Clipboard API not available — silently ignore
    }
  };
  const isAutomation = agentKind === "automation";
  const isUserSkillAutomation = isAutomation && automationTargetKind === "user-skill";
  const usesAutomationProjectScope =
    isAutomation &&
    automationTargetKind === "builtin";
  const usesAutomationProjectConcurrency = usesAutomationProjectScope;
  const showKindStep = !isEditing && wizardStep === "kind";
  const showDetailsStep = isEditing || wizardStep === "details";
  const showScheduleStep = isEditing || wizardStep === "schedule";

  const backlogDrainExcludedIds = (form.watch("backlogDrainExcludedWorkItemIds") ?? []) as string[];
  const backlogDrainConcurrency = (form.watch("backlogDrainProjectConcurrency") ?? {}) as Record<string, number>;
  const automationProjectIdSet = new Set(automationProjectIds);
  const selectedAutomationProjects = projects.filter((project) => automationProjectIdSet.has(project.id));
  const backlogDrainItemById = new Map(backlogDrainWorkItems.map((item) => [item.id, item]));
  const getBacklogDrainDepth = (itemId: string): number => {
    let depth = 0;
    let current = backlogDrainItemById.get(itemId);
    const seen = new Set<string>();
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = backlogDrainItemById.get(current.parentId);
      if (!parent) break;
      depth++;
      current = parent;
    }
    return depth;
  };
  const toggleBacklogDrainExclusion = (workItemId: string, checked: boolean) => {
    const current = (form.getValues("backlogDrainExcludedWorkItemIds") ?? []) as string[];
    const next = checked
      ? Array.from(new Set([...current, workItemId]))
      : current.filter((id) => id !== workItemId);
    form.setValue("backlogDrainExcludedWorkItemIds", next, { shouldDirty: true });
  };
  const toggleAutomationProject = (projectId: string) => {
    const current = (form.getValues("automationProjectIds") ?? []) as string[];
    const next = current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : Array.from(new Set([...current, projectId]));
    form.setValue("automationProjectIds", next, { shouldDirty: true });
  };
  const clearAutomationProjects = () => {
    form.setValue("automationProjectIds", [], { shouldDirty: true });
  };

  const selectAgentKind = (kind: "repository" | "automation") => {
    const currentProjectId = form.getValues("projectId") as string | undefined;
    const currentBacklogProjectIds = (form.getValues("backlogDrainProjectIds") ?? []) as string[];

    form.setValue("agentKind", kind, { shouldDirty: true });

    if (kind === "automation") {
      // Default automation = built-in backlog drain.
      form.setValue("automationTargetKind", "builtin", { shouldDirty: true });
      form.setValue("builtinAutomationId", "backlog-drain", { shouldDirty: true });
      form.setValue("automationSkillSlug", undefined, { shouldDirty: true });
      if (currentProjectId) {
        form.setValue("automationProjectIds", [currentProjectId], { shouldDirty: true });
      }
      form.setValue("projectId", "", { shouldDirty: true });
      return;
    }

    // Repository agent: clear automation target, restore single project from backlog selection if any.
    form.setValue("automationTargetKind", "builtin", { shouldDirty: true });
    form.setValue("builtinAutomationId", "backlog-drain", { shouldDirty: true });
    form.setValue("automationSkillSlug", undefined, { shouldDirty: true });
    if (!currentProjectId && currentBacklogProjectIds.length === 1) {
      form.setValue("projectId", currentBacklogProjectIds[0], { shouldDirty: true });
    }
    const currentAutomationProjectIds = (form.getValues("automationProjectIds") ?? []) as string[];
    if (!form.getValues("projectId") && currentAutomationProjectIds.length === 1) {
      form.setValue("projectId", currentAutomationProjectIds[0], { shouldDirty: true });
    }
  };

  const selectAutomationTarget = (
    target: { kind: "builtin"; id: BuiltinAutomationId } | { kind: "user-skill"; slug: string },
  ) => {
    form.setValue("automationTargetKind", target.kind, { shouldDirty: true });
    if (target.kind === "user-skill") {
      form.setValue("automationSkillSlug", target.slug, { shouldDirty: true });
      form.setValue("builtinAutomationId", "backlog-drain", { shouldDirty: true });
      // user-skill automation needs a single target project; clear backlog-only state
      const currentBacklog = (form.getValues("backlogDrainProjectIds") ?? []) as string[];
      const currentProjectId = form.getValues("projectId") as string | undefined;
      if (!currentProjectId && currentBacklog.length === 1) {
        form.setValue("projectId", currentBacklog[0], { shouldDirty: true });
      }
      const currentAutomationProjectIds = (form.getValues("automationProjectIds") ?? []) as string[];
      if (!form.getValues("projectId") && currentAutomationProjectIds.length === 1) {
        form.setValue("projectId", currentAutomationProjectIds[0], { shouldDirty: true });
      }
    } else {
      form.setValue("builtinAutomationId", target.id, { shouldDirty: true });
      form.setValue("automationSkillSlug", undefined, { shouldDirty: true });
      const currentProjectId = form.getValues("projectId") as string | undefined;
      const currentAutomationProjectIds = (form.getValues("automationProjectIds") ?? []) as string[];
      // Only seed automationProjectIds from a sibling field when there is a
      // concrete projectId to migrate (user is switching from a single-project
      // mode such as user-skill or repository agent). An empty
      // automationProjectIds is intentional — it means "all projects" and
      // must round-trip back to the backend untouched. Don't fall back to
      // backlogDrainProjectIds because that mirror was the bug that turned
      // a freshly-saved "all projects" agent into an explicit project list
      // the next time the user clicked the same builtin tile.
      if (currentAutomationProjectIds.length === 0 && currentProjectId) {
        form.setValue("automationProjectIds", [currentProjectId], { shouldDirty: true });
      }
      form.setValue("projectId", "", { shouldDirty: true });
    }
  };

  const renderProjectField = () => (
    <FormField
      control={form.control}
      name="projectId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Project</FormLabel>
          <Select
            onValueChange={(value) => field.onChange(value === NO_PROJECT_VALUE ? "" : value)}
            value={field.value || NO_PROJECT_VALUE}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={NO_PROJECT_VALUE}>
                No project — organization-wide
              </SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormDescription>
            Optional. Leave empty when this agent should not be tied to one project.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const renderAutomationProjectScopeField = () => (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Project scope
        </h3>
        <p className="text-sm text-muted-foreground">
          Leave empty to run across all projects, or select one or more projects to scope this automation.
        </p>
      </div>

      <Popover open={projectScopeOpen} onOpenChange={setProjectScopeOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={projectScopeOpen}
            className="min-h-11 w-full justify-between font-normal"
          >
            {automationProjectIds.length === 0
              ? "All projects"
              : `${automationProjectIds.length} project${automationProjectIds.length === 1 ? "" : "s"} selected`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search projects..." />
            <CommandList>
              <CommandEmpty>No projects found.</CommandEmpty>
              <CommandItem value="all-projects" onSelect={clearAutomationProjects}>
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    automationProjectIds.length === 0 ? "opacity-100" : "opacity-0",
                  )}
                />
                All projects
              </CommandItem>
              {projects.map((project) => {
                const selected = automationProjectIdSet.has(project.id);
                return (
                  <CommandItem
                    key={project.id}
                    value={`${project.name} ${project.id}`}
                    onSelect={() => toggleAutomationProject(project.id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {project.name}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedAutomationProjects.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedAutomationProjects.map((project) => (
            <Badge key={project.id} variant="secondary" className="gap-1.5 py-1">
              {project.name}
              <button
                type="button"
                className="inline-flex size-5 items-center justify-center rounded-full hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${project.name}`}
                onClick={() => toggleAutomationProject(project.id)}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          No project chips selected. This automation is organization-wide.
        </p>
      )}

      {usesAutomationProjectConcurrency && selectedAutomationProjects.length > 0 && (
        <div className="space-y-2 rounded-lg border bg-background p-3">
          <p className="text-sm font-medium">Open tickets per project</p>
          <p className="text-xs text-muted-foreground">
            These limits keep this automation from occupying an entire project queue.
          </p>
          <div className="space-y-2">
            {selectedAutomationProjects.map((project) => (
              <div key={project.id} className="grid grid-cols-[1fr_96px] items-center gap-3">
                <span className="text-sm font-medium">{project.name}</span>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={backlogDrainConcurrency[project.id] ?? form.watch("backlogDrainDefaultMaxConcurrentJobs") ?? 1}
                  onChange={(event) => {
                    form.setValue(
                      "backlogDrainProjectConcurrency",
                      { ...backlogDrainConcurrency, [project.id]: Number(event.target.value) },
                      { shouldDirty: true },
                    );
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderAiSettings = (helperText?: string) => (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          AI Settings
        </h3>
        {helperText && <p className="text-sm text-muted-foreground">{helperText}</p>}
      </div>

      <FormField
        control={form.control}
        name="codingAgent"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center gap-1">
              <FormLabel>Coding Agent</FormLabel>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  The CLI tool that executes the prompt.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {CODING_AGENT_OPTIONS.map((opt) => (
                <SelectableCard
                  key={opt.value}
                  selected={field.value === opt.value}
                  onClick={() => field.onChange(opt.value)}
                  icon={getCodingAgentIcon(opt.value)}
                  title={opt.label}
                  description={CODING_AGENT_DESCRIPTIONS[opt.value as CodingAgent]}
                  compact
                />
              ))}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {availableProviders.length === 1 ? (
        <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
          {getProviderIcon(availableProviders[0])}
          <span className="font-medium">{PROVIDER_LABEL_BY_VALUE[availableProviders[0]]}</span>
          <span className="text-muted-foreground">— inferred from coding agent</span>
        </div>
      ) : (
        <FormField
          control={form.control}
          name="aiProvider"
          render={({ field }) => (
            <FormItem>
              <FormLabel>AI Provider</FormLabel>
              <div className="grid gap-2 sm:grid-cols-3">
                {availableProviders.map((provider) => (
                  <SelectableCard
                    key={provider}
                    selected={field.value === provider}
                    onClick={() => field.onChange(provider)}
                    icon={getProviderIcon(provider)}
                    title={PROVIDER_LABEL_BY_VALUE[provider] ?? provider}
                    description=""
                    compact
                  />
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="aiModel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>AI Model</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value ?? ""}
                disabled={availableModels.length === 0}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={availableModels.length === 0 ? "Select provider first" : "Select model"}
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="reasoningLevel"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-1">
                <FormLabel>Reasoning Level</FormLabel>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    Higher levels use more tokens but produce better results for complex tasks.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select
                onValueChange={(value) => field.onChange(value === "__default__" ? undefined : value)}
                value={field.value ?? ""}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__default__">Default runtime behavior</SelectItem>
                  {availableReasoningLevels.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );

  const renderAdvancedMcpSettings = () => (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Runner MCP
        </h3>
        <p className="text-sm text-muted-foreground">
          Optional extra remote MCP servers injected into the runner. Platform servers like
          almirant, context7, memory, filesystem, playwright, and sequential-thinking are managed automatically.
        </p>
      </div>

      <FormField
        control={form.control}
        name="mcpServersJson"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center gap-1">
              <FormLabel>Additional MCP servers</FormLabel>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  Remote MCP only. Server names become tool prefixes, for example mcp__z_combinator__search.
                </TooltipContent>
              </Tooltip>
            </div>
            <FormControl>
              <Textarea
                className="min-h-[140px] font-mono text-xs"
                placeholder={'{\n  "z-combinator": {\n    "type": "remote",\n    "url": "https://mcp.example.com/mcp"\n  }\n}'}
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormDescription>
              Use JSON keyed by server name. Headers and local commands are intentionally blocked here; use a managed secret-backed integration for authenticated MCPs.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );

  const renderRepositoryConfiguration = () => (
    <>
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Configuration
        </h3>

        <FormField
          control={form.control}
          name="prompt"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-1">
                <FormLabel>Prompt</FormLabel>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    The message sent to the coding agent each time this schedule fires. Use /skill-name to load a skill automatically.
                  </TooltipContent>
                </Tooltip>
              </div>
              <FormControl>
                <SlashAutocompleteTextarea
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  skills={skills}
                  placeholder="Type / to invoke a skill, or write instructions..."
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="provider"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Provider</FormLabel>
              <div className="grid gap-2 sm:grid-cols-3">
                {PROVIDER_OPTIONS.map((opt) => (
                  <SelectableCard
                    key={opt.value}
                    selected={field.value === opt.value}
                    onClick={() => field.onChange(opt.value)}
                    icon={getCodingAgentIcon(opt.value)}
                    title={opt.label}
                    description={PROVIDER_DESCRIPTIONS[opt.value]}
                    compact
                  />
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {renderAiSettings()}
      {renderAdvancedMcpSettings()}
    </>
  );

  const renderBuiltinAutomationIcon = (id: BuiltinAutomationId) => {
    if (id === "dod-review") return <ShieldCheck className="size-5" />;
    if (id === "dod-remediation") return <ListChecks className="size-5" />;
    if (id === "release-integration") return <GitBranch className="size-5" />;
    return <ListChecks className="size-5" />;
  };

  const renderAutomationTypeSelector = () => (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Automation type
        </h3>
        <p className="text-sm text-muted-foreground">
          Pick a built-in automation or one of your skills.
        </p>
      </div>

      <div className="grid gap-2">
        {BUILTIN_AUTOMATIONS.map((automation) => (
          <SelectableCard
            key={automation.id}
            selected={
              automationTargetKind === "builtin" &&
              (automationSkillSlug == null || automationSkillSlug === "") &&
              builtinAutomationId === automation.id
            }
            onClick={() => selectAutomationTarget({ kind: "builtin", id: automation.id })}
            icon={renderBuiltinAutomationIcon(automation.id)}
            title={
              <span className="flex items-center gap-2">
                {automation.name}
                <Badge variant="secondary">Built-in</Badge>
              </span>
            }
            description={automation.description}
          />
        ))}
      </div>

      <div className="space-y-2 pt-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Your skills
        </p>
        {userSkills.length === 0 ? (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Create skills in <span className="font-mono">/skills</span> and they will appear here.
          </p>
        ) : (
          <div className="grid gap-2">
            {userSkills.map((skill) => (
              <SelectableCard
                key={skill.slug}
                selected={automationTargetKind === "user-skill" && automationSkillSlug === skill.slug}
                onClick={() => selectAutomationTarget({ kind: "user-skill", slug: skill.slug })}
                icon={<Sparkles className="size-5" />}
                title={
                  <span className="flex items-center gap-2">
                    {skill.name}
                    <span className="font-mono text-xs text-muted-foreground">/{skill.slug}</span>
                  </span>
                }
                description={skill.description ?? "No description provided."}
                rightSlot={<SkillSourceBadge source={skill.source} />}
              />
            ))}
          </div>
        )}
      </div>
      <FormField
        control={form.control}
        name="automationSkillSlug"
        render={() => <FormMessage />}
      />
    </div>
  );

  const renderBacklogDrainSection = () => (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {builtinAutomationId === "dod-remediation" ? "DoD remediation settings" : "Backlog drain settings"}
        </h3>
        <p className="text-sm text-muted-foreground">
          {builtinAutomationId === "dod-remediation"
            ? "Scan selected projects for DoD-incomplete Backlog items, set concurrency, and exclude work items the automation should not touch."
            : "Drain selected projects, set concurrency, and exclude work items the automation should not touch."}
        </p>
      </div>

      <FormField
        control={form.control}
        name="automationQuietPeriodMinutes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Quiet period in minutes</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={0}
                max={1440}
                value={field.value ?? 15}
                onChange={(event) => field.onChange(Number(event.target.value))}
              />
            </FormControl>
            <FormDescription>
              Wait this long after the latest item or child update before enqueuing it. Use 0 to disable the wait.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="backlogDrainDefaultMaxConcurrentJobs"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Default open tickets per project</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={1}
                max={100}
                value={field.value ?? 1}
                onChange={(event) => field.onChange(Number(event.target.value))}
              />
            </FormControl>
            <FormDescription>
              Maximum queued/running jobs per selected project, unless overridden in the scope section.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="backlogDrainExcludeDescendants"
        render={({ field }) => (
          <FormItem className="flex items-center justify-between rounded-lg border bg-background p-3">
            <div className="space-y-0.5">
              <FormLabel>Exclude descendants</FormLabel>
              <FormDescription>
                If you exclude a feature like FF2, all its children are excluded too.
              </FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Exclude work items</p>
          <Badge variant="outline">{backlogDrainExcludedIds.length} excluded</Badge>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border bg-background">
          {isLoadingBacklogDrainWorkItems ? (
            <p className="p-3 text-sm text-muted-foreground">Loading Backlog tree...</p>
          ) : backlogDrainWorkItems.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Select at least one project to load its work items.</p>
          ) : (
            <div className="divide-y">
              {backlogDrainWorkItems.map((item) => {
                const checked = backlogDrainExcludedIds.includes(item.id);
                return (
                  <label key={item.id} className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleBacklogDrainExclusion(item.id, value === true)}
                    />
                    <span style={{ paddingLeft: `${getBacklogDrainDepth(item.id) * 14}px` }} className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{item.taskId ?? item.type}</span> · {item.title}
                    </span>
                    <Badge variant={item.columnRole === "backlog" ? "default" : "secondary"}>
                      {item.columnRole ?? "parent"}
                    </Badge>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-background p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Preview</p>
          {isLoadingBacklogDrainPreview && (
            <span className="text-xs text-muted-foreground">Refreshing...</span>
          )}
        </div>
        {backlogDrainPreview ? (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Badge variant="outline">Ready: {backlogDrainPreview.candidates.length}</Badge>
            <Badge variant="outline">Blocked: {backlogDrainPreview.skipped.blocked.length}</Badge>
            <Badge variant="outline">Excluded: {backlogDrainPreview.skipped.excluded.length}</Badge>
            <Badge variant="outline">Active: {backlogDrainPreview.skipped.active.length}</Badge>
            <Badge variant="outline">Recent changes: {backlogDrainPreview.skipped.recentlyModified?.length ?? 0}</Badge>
            {builtinAutomationId === "dod-remediation" ? (
              <>
                <Badge variant="outline">Missing report: {backlogDrainPreview.skipped.missingDodReport?.length ?? 0}</Badge>
                <Badge variant="outline">Needs human: {backlogDrainPreview.skipped.humanReviewRequired?.length ?? 0}</Badge>
              </>
            ) : (
              <Badge variant="outline">DoD incomplete: {backlogDrainPreview.skipped.dodIncomplete?.length ?? 0}</Badge>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Select projects to preview what would be enqueued.</p>
        )}
        {backlogDrainPreview && backlogDrainPreview.candidates.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {backlogDrainPreview.candidates.slice(0, 5).map((candidate) => (
              <li key={candidate.id} className="truncate text-muted-foreground">
                <span className="font-medium text-foreground">{candidate.taskId ?? candidate.type}</span> · {candidate.title} · {candidate.codingAgent}/{candidate.model}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const renderDodReviewSection = () => (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Definition of Done review settings
        </h3>
        <p className="text-sm text-muted-foreground">
          The agent waits until the task has been quiet for this long before reviewing it.
        </p>
      </div>

      <FormField
        control={form.control}
        name="automationQuietPeriodMinutes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Quiet period in minutes</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={0}
                max={1440}
                value={field.value ?? 15}
                onChange={(event) => field.onChange(Number(event.target.value))}
              />
            </FormControl>
            <FormDescription>
              Recommended: 15 minutes. Use 0 to review immediately.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="backlogDrainDefaultMaxConcurrentJobs"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Default open tickets per project</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={1}
                max={100}
                value={field.value ?? 1}
                onChange={(event) => field.onChange(Number(event.target.value))}
              />
            </FormControl>
            <FormDescription>
              Maximum queued/running DoD review sessions per selected project. Override per project in the scope section.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );

  const renderReleaseIntegrationSection = () => (
    <div className="space-y-4">
      <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
        Release integration starts as soon as the schedule ticks. It reads Validating tasks,
        reuses the active release batch when possible, and creates/reuses the release PR for
        the integration branch.
      </div>

      <FormField
        control={form.control}
        name="automationQuietPeriodMinutes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Quiet period in minutes</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={0}
                max={1440}
                value={field.value ?? 15}
                onChange={(event) => field.onChange(Number(event.target.value))}
              />
            </FormControl>
            <FormDescription>
              Wait this long after the validating item changes before adding it to a release batch. Use 0 to disable the wait.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="backlogDrainDefaultMaxConcurrentJobs"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Default open tickets per project</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={1}
                max={100}
                value={field.value ?? 1}
                onChange={(event) => field.onChange(Number(event.target.value))}
              />
            </FormControl>
            <FormDescription>
              Maximum active release-integration items per selected project. Override per project in the scope section.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );

  const renderScheduleStep = () => (
    <>
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Trigger
        </h3>

        <FormField
          control={form.control}
          name="trigger"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <RadioGroup
                  value={field.value ?? "scheduled"}
                  onValueChange={field.onChange}
                  className="grid grid-cols-2 gap-3"
                >
                  <label
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 hover:bg-muted/40",
                      field.value === "scheduled" && "border-primary bg-primary/5",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="scheduled" />
                      <Clock className="size-4" />
                      <span className="text-sm font-medium">Scheduled</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      Runs on a cron / time-window or only on demand from this UI.
                    </p>
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 hover:bg-muted/40",
                      field.value === "webhook" && "border-primary bg-primary/5",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="webhook" />
                      <Webhook className="size-4" />
                      <span className="text-sm font-medium">Webhook</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      Invoked by an external POST/GET against a tokenised URL.
                    </p>
                  </label>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {isWebhookTrigger && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start gap-2">
              <Webhook className="size-4 mt-0.5 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Webhook endpoints</p>
                <p className="text-xs text-muted-foreground">
                  These URLs are proposed before saving. The test URL only validates reachability;
                  production can enqueue jobs after this agent is saved.
                </p>
              </div>
            </div>

            {isLoadingWebhookProposal && !webhookUrl ? (
              <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Preparing webhook URLs...
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <FormLabel>Production webhook</FormLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={webhookUrl}
                      className="font-mono text-xs"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!webhookUrl}
                      onClick={() => handleCopyWebhookUrl(webhookUrl)}
                    >
                      {copiedWebhookUrl === webhookUrl ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      {copiedWebhookUrl === webhookUrl ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    POST <code className="rounded bg-muted px-1">{`{"prompt":"…"}`}</code> to
                    append a user prompt; GET runs with the system prompt only.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <FormLabel>Test webhook</FormLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={testWebhookUrl}
                      className="font-mono text-xs"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!testWebhookUrl}
                      onClick={() => handleCopyWebhookUrl(testWebhookUrl)}
                    >
                      {copiedWebhookUrl === testWebhookUrl ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      {copiedWebhookUrl === testWebhookUrl ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use this from Postman, curl, or another system to confirm the endpoint responds before saving.
                  </p>
                </div>
              </div>
            )}

            <FormField
              control={form.control}
              name="webhookUrl"
              render={() => (
                <FormItem>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
      </div>

      {!isWebhookTrigger && (
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Schedule
        </h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="scheduleType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Schedule Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select schedule type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="time_window">Time Window</SelectItem>
                    <SelectItem value="cron">Cron Expression</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {!isManualSchedule && (
            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => {
                const selectedTz = TIMEZONE_OPTIONS.find((tz) => tz.value === field.value);
                return (
                  <FormItem className="flex flex-col">
                    <div className="flex items-center gap-1">
                      <FormLabel>Timezone</FormLabel>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          Schedule times are interpreted in this timezone.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Popover open={timezoneOpen} onOpenChange={setTimezoneOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={timezoneOpen}
                            className={cn(
                              "w-full justify-between font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                          >
                            {selectedTz
                              ? `${selectedTz.label} (${selectedTz.offset})`
                              : "Select timezone"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[280px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search timezone..." />
                          <CommandList>
                            <CommandEmpty>No timezone found.</CommandEmpty>
                            {TIMEZONE_OPTIONS.map((tz) => (
                              <CommandItem
                                key={tz.value}
                                value={tz.label}
                                onSelect={() => {
                                  field.onChange(tz.value);
                                  setTimezoneOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    field.value === tz.value ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                {tz.label} ({tz.offset})
                              </CommandItem>
                            ))}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          )}
        </div>

        {isManualSchedule && (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            This agent will be created as a draft. You can add a schedule later.
          </div>
        )}

        {scheduleType === "time_window" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="startHour"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Hour</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(Number(value))}
                      value={field.value?.toString() ?? ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select start hour" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {HOUR_OPTIONS.map((hour) => (
                          <SelectItem key={hour.value} value={hour.value.toString()}>
                            {hour.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endHour"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Hour</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(Number(value))}
                      value={field.value?.toString() ?? ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select end hour" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {HOUR_OPTIONS.map((hour) => (
                          <SelectItem key={hour.value} value={hour.value.toString()}>
                            {hour.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="daysOfWeek"
              render={({ field }) => {
                const currentDays = (field.value ?? []).map(Number);
                const arraysEqual = (a: number[], b: readonly number[]) => {
                  const left = [...a].sort((x, y) => x - y);
                  const right = [...b].sort((x, y) => x - y);
                  return left.length === right.length && left.every((v, i) => v === right[i]);
                };

                return (
                  <FormItem>
                    <FormLabel>Days of Week</FormLabel>
                    <FormDescription>
                      Select the days when the agent should run
                    </FormDescription>

                    <div className="flex gap-2 mt-2">
                      <Button
                        type="button"
                        variant={arraysEqual(currentDays, DAY_PRESETS.weekdays) ? "default" : "outline"}
                        size="sm"
                        aria-pressed={arraysEqual(currentDays, DAY_PRESETS.weekdays)}
                        onClick={() => field.onChange([...DAY_PRESETS.weekdays])}
                      >
                        Weekdays
                      </Button>
                      <Button
                        type="button"
                        variant={arraysEqual(currentDays, DAY_PRESETS.weekend) ? "default" : "outline"}
                        size="sm"
                        aria-pressed={arraysEqual(currentDays, DAY_PRESETS.weekend)}
                        onClick={() => field.onChange([...DAY_PRESETS.weekend])}
                      >
                        Weekend
                      </Button>
                      <Button
                        type="button"
                        variant={arraysEqual(currentDays, DAY_PRESETS.everyday) ? "default" : "outline"}
                        size="sm"
                        aria-pressed={arraysEqual(currentDays, DAY_PRESETS.everyday)}
                        onClick={() => field.onChange([...DAY_PRESETS.everyday])}
                      >
                        Every day
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-3">
                      {DAY_OF_WEEK_OPTIONS.map((day) => {
                        const isSelected = currentDays.includes(day.value);
                        return (
                          <Button
                            key={day.value}
                            type="button"
                            variant={isSelected ? "default" : "outline"}
                            size="sm"
                            aria-pressed={isSelected}
                            className="min-w-[48px]"
                            onClick={() => {
                              if (isSelected) {
                                field.onChange(currentDays.filter((v: number) => v !== day.value));
                              } else {
                                field.onChange([...currentDays, day.value]);
                              }
                            }}
                          >
                            {day.label.slice(0, 3)}
                          </Button>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          </>
        )}

        {scheduleType === "cron" && (
          <FormField
            control={form.control}
            name="cronExpression"
            render={({ field }) => {
              const cronDescription = getCronDescription(field.value ?? "");
              const guidedCron = parseGuidedCronExpression(field.value ?? "");
              const activeMode = resolveCronFormActiveMode({
                expression: field.value,
                parsedMode: guidedCron?.mode,
              });
              const selectedInterval = guidedCron?.intervalMinutes ?? 15;
              const selectedHour = guidedCron?.hour ?? 9;
              const selectedMinute = guidedCron?.minute ?? 0;
              const selectedDays = guidedCron?.daysOfWeek ?? [...DAY_PRESETS.weekdays];

              const applyCron = (
                nextConfig: Parameters<typeof buildCronExpression>[0],
              ) => {
                const nextExpression = buildCronExpression(nextConfig);
                if (nextExpression) {
                  field.onChange(nextExpression);
                }
              };

              const handleTabChange = (next: string) => {
                if (next === "interval") applyCron(DEFAULT_GUIDED_CRON.interval);
                else if (next === "hourly") applyCron(DEFAULT_GUIDED_CRON.hourly);
                else if (next === "daily") applyCron(DEFAULT_GUIDED_CRON.daily);
                else if (next === "weekly") applyCron(DEFAULT_GUIDED_CRON.weekly);
                else if (next === "custom" && activeMode !== "custom") field.onChange("");
              };

              return (
                <FormItem>
                  <FormLabel>Frequency</FormLabel>
                  <Tabs value={activeMode} onValueChange={handleTabChange} className="space-y-3">
                    <TabsList className="grid h-auto w-full grid-cols-5 bg-muted p-1">
                      <TabsTrigger
                        value="interval"
                        className="gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground dark:data-[state=active]:border-transparent"
                      >
                        <Timer className="size-3.5" /> Every
                      </TabsTrigger>
                      <TabsTrigger
                        value="hourly"
                        className="gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground dark:data-[state=active]:border-transparent"
                      >
                        <Hourglass className="size-3.5" /> Hourly
                      </TabsTrigger>
                      <TabsTrigger
                        value="daily"
                        className="gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground dark:data-[state=active]:border-transparent"
                      >
                        <Sun className="size-3.5" /> Daily
                      </TabsTrigger>
                      <TabsTrigger
                        value="weekly"
                        className="gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground dark:data-[state=active]:border-transparent"
                      >
                        <CalendarDays className="size-3.5" /> Weekly
                      </TabsTrigger>
                      <TabsTrigger
                        value="custom"
                        className="gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground dark:data-[state=active]:border-transparent"
                      >
                        <Settings2 className="size-3.5" /> Custom
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="interval" className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Run every N minutes.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {GUIDED_CRON_INTERVAL_OPTIONS.map((minutes) => (
                          <Button
                            key={minutes}
                            type="button"
                            variant={selectedInterval === minutes ? "default" : "outline"}
                            size="sm"
                            onClick={() =>
                              applyCron({
                                mode: "interval",
                                intervalMinutes: minutes,
                              })
                            }
                          >
                            Every {minutes} min
                          </Button>
                        ))}
                      </div>
                    </TabsContent>

                    <TabsContent value="hourly">
                      <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        Runs once every hour, at minute 00.
                      </p>
                    </TabsContent>

                    <TabsContent value="daily" className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Hour</p>
                        <Select
                          onValueChange={(value) =>
                            applyCron({
                              mode: "daily",
                              hour: Number(value),
                              minute: selectedMinute,
                            })
                          }
                          value={selectedHour.toString()}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select hour" />
                          </SelectTrigger>
                          <SelectContent>
                            {HOUR_OPTIONS.map((hour) => (
                              <SelectItem key={hour.value} value={hour.value.toString()}>
                                {hour.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Minute</p>
                        <Select
                          onValueChange={(value) =>
                            applyCron({
                              mode: "daily",
                              hour: selectedHour,
                              minute: Number(value),
                            })
                          }
                          value={selectedMinute.toString()}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select minute" />
                          </SelectTrigger>
                          <SelectContent>
                            {GUIDED_CRON_MINUTE_OPTIONS.map((minute) => (
                              <SelectItem key={minute} value={minute.toString()}>
                                {minute.toString().padStart(2, "0")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TabsContent>

                    <TabsContent value="weekly" className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={
                            selectedDays.length === DAY_PRESETS.weekdays.length &&
                            DAY_PRESETS.weekdays.every((day) => selectedDays.includes(day))
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() =>
                            applyCron({
                              mode: "weekly",
                              daysOfWeek: [...DAY_PRESETS.weekdays],
                              hour: selectedHour,
                              minute: selectedMinute,
                            })
                          }
                        >
                          Weekdays
                        </Button>
                        <Button
                          type="button"
                          variant={
                            selectedDays.length === DAY_PRESETS.weekend.length &&
                            DAY_PRESETS.weekend.every((day) => selectedDays.includes(day))
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() =>
                            applyCron({
                              mode: "weekly",
                              daysOfWeek: [...DAY_PRESETS.weekend],
                              hour: selectedHour,
                              minute: selectedMinute,
                            })
                          }
                        >
                          Weekend
                        </Button>
                        <Button
                          type="button"
                          variant={
                            selectedDays.length === DAY_PRESETS.everyday.length &&
                            DAY_PRESETS.everyday.every((day) => selectedDays.includes(day))
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() =>
                            applyCron({
                              mode: "weekly",
                              daysOfWeek: [...DAY_PRESETS.everyday],
                              hour: selectedHour,
                              minute: selectedMinute,
                            })
                          }
                        >
                          Every day
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {DAY_OF_WEEK_OPTIONS.map((day) => {
                          const isSelected = selectedDays.includes(day.value);
                          const nextDays = isSelected
                            ? selectedDays.filter((value) => value !== day.value)
                            : [...selectedDays, day.value];

                          return (
                            <Button
                              key={day.value}
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              className="min-w-[48px]"
                              onClick={() =>
                                applyCron({
                                  mode: "weekly",
                                  daysOfWeek: nextDays,
                                  hour: selectedHour,
                                  minute: selectedMinute,
                                })
                              }
                            >
                              {day.label.slice(0, 3)}
                            </Button>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Hour</p>
                          <Select
                            onValueChange={(value) =>
                              applyCron({
                                mode: "weekly",
                                daysOfWeek: selectedDays,
                                hour: Number(value),
                                minute: selectedMinute,
                              })
                            }
                            value={selectedHour.toString()}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select hour" />
                            </SelectTrigger>
                            <SelectContent>
                              {HOUR_OPTIONS.map((hour) => (
                                <SelectItem key={hour.value} value={hour.value.toString()}>
                                  {hour.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Minute</p>
                          <Select
                            onValueChange={(value) =>
                              applyCron({
                                mode: "weekly",
                                daysOfWeek: selectedDays,
                                hour: selectedHour,
                                minute: Number(value),
                              })
                            }
                            value={selectedMinute.toString()}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select minute" />
                            </SelectTrigger>
                            <SelectContent>
                              {GUIDED_CRON_MINUTE_OPTIONS.map((minute) => (
                                <SelectItem key={minute} value={minute.toString()}>
                                  {minute.toString().padStart(2, "0")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="custom">
                      <FormControl>
                        <Input placeholder="*/30 * * * *" {...field} value={field.value ?? ""} />
                      </FormControl>
                    </TabsContent>
                  </Tabs>

                  {cronDescription && (
                    <p className="text-xs text-muted-foreground">{cronDescription}</p>
                  )}
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        )}
      </div>
      )}

      {!isWebhookTrigger && (
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Limits
        </h3>

        <FormField
          control={form.control}
          name="maxJobsPerRun"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-1">
                <FormLabel>Max Jobs Per Run</FormLabel>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    Maximum number of agent sessions created each time the schedule triggers.
                  </TooltipContent>
                </Tooltip>
              </div>
              <FormControl>
                <Input type="number" min={1} max={100} placeholder="10" {...field} />
              </FormControl>
              <FormDescription>
                Maximum number of items to process in each run (1-100)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <FormLabel>Enabled</FormLabel>
                <FormDescription>
                  {isManualSchedule
                    ? "Manual drafts stay disabled until you add a schedule"
                    : "Enable or disable this scheduled agent"}
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isManualSchedule}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
      )}
    </>
  );

  return (
    <TooltipProvider>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="sm:max-w-xl w-full flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle>
              {isEditing ? "Edit Scheduled Agent" : "New Scheduled Agent"}
            </SheetTitle>
            <SheetDescription>
              {showKindStep
                ? "First choose whether you are creating a repository agent or an automation process."
                : isAutomation
                  ? "Configure a scheduled process that runs a built-in or user-defined skill."
                  : "Configure when and how this agent should run in a project repository."}
            </SheetDescription>
          </SheetHeader>

          {!isEditing && (
            <div className="border-b px-6 py-3">
              <StepIndicator currentStep={wizardStep} />
            </div>
          )}

          <Form {...form}>
            <form onSubmit={onSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto px-6">
                <div className="space-y-6 pb-6">
                  {showKindStep && (
                    <div className="space-y-4 pt-2">
                      <div className="space-y-1">
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                          What are you creating?
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          A repository agent runs a coding agent against one project. An automation process is a cronjob that fires a skill — it has no prompt of its own.
                        </p>
                      </div>

                      <div className="grid gap-3">
                        <SelectableCard
                          selected={agentKind === "repository"}
                          onClick={() => selectAgentKind("repository")}
                          icon={<GitBranch className="size-5" />}
                          title="Repository agent"
                          description="Runs a coding agent against one project repository. Use it for PR work, review, validation, bug fixing, or any custom prompt scoped to a specific repo."
                          rightSlot={
                            agentKind === "repository" ? <Badge variant="secondary">Selected</Badge> : null
                          }
                        />

                        <SelectableCard
                          selected={agentKind === "automation"}
                          onClick={() => selectAgentKind("automation")}
                          icon={<Workflow className="size-5" />}
                          title="Automation process"
                          description="Cronjob that fires a skill (built-in or one of yours). It has no prompt — the skill is the unit of work."
                          rightSlot={
                            agentKind === "automation" ? <Badge variant="secondary">Selected</Badge> : null
                          }
                        />
                      </div>
                    </div>
                  )}

                  {showDetailsStep && (
                    <>
                      {/* Basic Information */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                          Basic Information
                        </h3>

                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Name</FormLabel>
                              <FormControl>
                                <Input placeholder="My scheduled agent" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Describe what this agent does..."
                                  className="min-h-[80px] resize-none"
                                  {...field}
                                  value={field.value ?? ""}
                                />
                              </FormControl>
                              <FormDescription>
                                Optional description for documentation purposes
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {!backlogDrainEnabled && !usesAutomationProjectScope && renderProjectField()}
                      </div>

                      {!isAutomation && renderRepositoryConfiguration()}

                      {isAutomation && (
                        <>
                          {renderAutomationTypeSelector()}
                          {usesAutomationProjectScope && renderAutomationProjectScopeField()}
                          {backlogDrainEnabled && renderBacklogDrainSection()}
                          {automationTargetKind === "builtin" && builtinAutomationId === "dod-review" && renderDodReviewSection()}
                          {automationTargetKind === "builtin" && builtinAutomationId === "release-integration" && renderReleaseIntegrationSection()}
                          {isUserSkillAutomation && (
                            renderAiSettings(
                              "Runtime used to execute the selected skill on each schedule tick.",
                            )
                          )}
                          {automationTargetKind === "builtin" && builtinAutomationId === "dod-review" &&
                            renderAiSettings(
                              "Runtime used to run the read-only Definition of Done review job.",
                            )}
                          {automationTargetKind === "builtin" && builtinAutomationId === "release-integration" &&
                            renderAiSettings(
                              "Runtime used to run release integration sessions.",
                            )}
                          {backlogDrainEnabled &&
                            renderAiSettings(
                              "Fallback runtime used for generated implementation jobs when a project, work item, or per-project rule does not provide a more specific runtime.",
                            )}
                          {renderAdvancedMcpSettings()}
                        </>
                      )}
                    </>
                  )}

                  {showScheduleStep && renderScheduleStep()}
                </div>
              </div>

              <SheetFooter className="flex-row items-center justify-between gap-2 border-t px-6 py-4 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="link"
                  className="px-0 text-muted-foreground hover:text-foreground"
                  disabled={isPending}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <div className="flex items-center gap-2">
                  {!isEditing && wizardStep !== "kind" && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => setWizardStep(wizardStep === "schedule" ? "details" : "kind")}
                    >
                      Back
                    </Button>
                  )}
                  {!isEditing && wizardStep !== "schedule" ? (
                    <Button
                      type="button"
                      disabled={isPending}
                      onClick={() => setWizardStep(wizardStep === "kind" ? "details" : "schedule")}
                    >
                      Continue
                    </Button>
                  ) : (
                    <Button type="submit" disabled={isPending}>
                      {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create"}
                    </Button>
                  )}
                </div>
              </SheetFooter>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
};
