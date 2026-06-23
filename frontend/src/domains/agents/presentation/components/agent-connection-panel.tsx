"use client";

import { Bot, Clipboard, KeyRound, Link2, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { AgentConnection, AgentConnectionPanelProps } from "../../domain/types";

const formatDate = (value: string | null): string => {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const ConnectedAgentRow: React.FC<{
  connection: AgentConnection;
  isRevoking: boolean;
  onRevoke: (id: string) => void;
}> = ({ connection, isRevoking, onRevoke }) => {
  const isVerified =
    connection.verificationStatus === "verified" || !!connection.lastUsedAt;
  const statusLabel = !connection.isActive
    ? "Revoked"
    : isVerified
      ? "Verified"
      : "Pending verification";

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{connection.name}</span>
          <Badge variant={connection.isActive && isVerified ? "default" : "secondary"}>
            {statusLabel}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Key {connection.keyPrefix}… · Last used {formatDate(connection.lastUsedAt)} · Created {formatDate(connection.createdAt)}
        </p>
        {!isVerified && connection.isActive ? (
          <p className="text-xs text-muted-foreground">
            Almirant created the credential, but the agent still needs to verify MCP by calling a tool such as list_projects.
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={isRevoking || !connection.isActive}
        onClick={() => onRevoke(connection.id)}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Revoke
      </Button>
    </div>
  );
};

export const AgentConnectionPanel: React.FC<AgentConnectionPanelProps> = ({
  projectOptions,
  selectedProjectId,
  agentName,
  generatedPrompt,
  connections,
  isLoading,
  isGenerating,
  isRevoking,
  canGenerate,
  onProjectChange,
  onAgentNameChange,
  onGeneratePrompt,
  onCopyPrompt,
  onRevokeConnection,
}) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-primary" />
              Connect external agent
            </CardTitle>
            <CardDescription>
              Generate a one-use prompt so a cloud agent can claim MCP access to this self-hosted instance for all projects or for one specific project.
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit">
            <ShieldCheck className="mr-1 h-3 w-3" />
            10 min · one use
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="agent-connection-project">Project</Label>
            <Select value={selectedProjectId} onValueChange={onProjectChange} disabled={isLoading || projectOptions.length === 0}>
              <SelectTrigger id="agent-connection-project">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projectOptions.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="agent-connection-name">Agent name</Label>
            <Input
              id="agent-connection-name"
              value={agentName}
              onChange={(event) => onAgentNameChange(event.target.value)}
              placeholder="OpenClaw Agent"
              maxLength={80}
            />
          </div>

          <Button type="button" className="cursor-pointer" disabled={!canGenerate} onClick={onGeneratePrompt}>
            <KeyRound className="mr-2 h-4 w-4" />
            {isGenerating ? "Generating…" : "Generate prompt"}
          </Button>
        </div>

        {projectOptions.length === 0 && !isLoading ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Create a project first. MCP access is project-scoped, so the pairing prompt needs a target project.
          </p>
        ) : null}

        {generatedPrompt ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="agent-connection-prompt">Prompt to paste into your agent</Label>
              <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={onCopyPrompt}>
                <Clipboard className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
            <Textarea
              id="agent-connection-prompt"
              readOnly
              value={generatedPrompt.prompt}
              className="min-h-36 resize-y font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Expires {formatDate(generatedPrompt.expiresAt)}. The prompt contains only a temporary claim URL, not a permanent API key.
              The generated instructions tell the agent to make a single GET request and verify MCP with list_projects before considering the connection ready.
            </p>
          </div>
        ) : null}

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Connected external agents</h3>
            <p className="text-xs text-muted-foreground">
              These are revocable API keys created through the pairing flow.
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : connections.length > 0 ? (
            <div className="space-y-2">
              {connections.map((connection) => (
                <ConnectedAgentRow
                  key={connection.id}
                  connection={connection}
                  isRevoking={isRevoking}
                  onRevoke={onRevokeConnection}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No external agents connected yet. Generate a prompt and paste it into your cloud agent to pair it.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
