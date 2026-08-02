"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Plus, Plug, RefreshCw, Server, Store, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAgentMcpServers,
  useAgentPlugins,
  useAddPluginMarketplace,
  useCreateAgentMcpServer,
  useCreateMcpServerFromTemplate,
  useCreateAgentPlugin,
  useDeleteAgentMcpServer,
  useDeleteAgentPlugin,
  useDeletePluginMarketplace,
  useInstallMarketplacePlugin,
  useMcpConnectorTemplates,
  usePluginMarketplaces,
  usePluginPackages,
  useSyncPluginMarketplace,
  useTestAgentMcpServer,
  useUploadPluginPackage,
  useUpdateAgentMcpServer,
  useUpdateAgentPlugin,
} from "../../application/hooks/use-agent-tooling";
import type {
  AgentMcpServer,
  AgentPlugin,
  McpConnectionTestResult,
  McpConnectorTemplate,
  McpConnectorTemplateKey,
  McpAuthType,
} from "../../domain/types";

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const EmptyState = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
  <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
    <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
      {icon}
    </div>
    <h3 className="font-medium">{title}</h3>
    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
  </div>
);

export const AgentMcpServersContainer = () => {
  const { data: servers = [], isLoading } = useAgentMcpServers();
  const { data: templates = [] } = useMcpConnectorTemplates();
  const createMutation = useCreateAgentMcpServer();
  const createTemplateMutation = useCreateMcpServerFromTemplate();
  const updateMutation = useUpdateAgentMcpServer();
  const deleteMutation = useDeleteAgentMcpServer();
  const testMutation = useTestAgentMcpServer();
  const [editing, setEditing] = useState<AgentMcpServer | null>(null);
  const [open, setOpen] = useState(false);
  const [testResult, setTestResult] = useState<McpConnectionTestResult | null>(null);
  const [form, setForm] = useState({
    templateKey: null as McpConnectorTemplateKey | null,
    name: "",
    slug: "",
    description: "",
    url: "",
    authType: "none" as McpAuthType,
    authHeaderName: "X-Api-Key",
    secret: "",
    clearSecret: false,
  });

  const isPending =
    createMutation.isPending ||
    createTemplateMutation.isPending ||
    updateMutation.isPending;
  const selectedTemplate = templates.find(
    (template) => template.key === form.templateKey,
  );

  const openCreate = () => {
    setEditing(null);
    setTestResult(null);
    setForm({
      templateKey: null,
      name: "",
      slug: "",
      description: "",
      url: "",
      authType: "none",
      authHeaderName: "X-Api-Key",
      secret: "",
      clearSecret: false,
    });
    setOpen(true);
  };

  const openTemplate = (template: McpConnectorTemplate) => {
    setEditing(null);
    setTestResult(null);
    setForm({
      templateKey: template.key,
      name: template.name,
      slug: template.runnerServerName,
      description: template.description,
      url: template.url,
      authType: template.authType,
      authHeaderName: template.authHeaderName,
      secret: "",
      clearSecret: false,
    });
    setOpen(true);
  };

  const openEdit = (server: AgentMcpServer) => {
    setEditing(server);
    setTestResult(null);
    setForm({
      templateKey: server.templateKey,
      name: server.name,
      slug: server.slug,
      description: server.description ?? "",
      url: server.url,
      authType: server.authType,
      authHeaderName: server.authHeaderName ?? "X-Api-Key",
      secret: "",
      clearSecret: false,
    });
    setOpen(true);
  };

  const submit = () => {
    const commonPayload = {
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name),
      description: form.description.trim() || null,
      ...(form.secret.trim() ? { secret: form.secret.trim() } : {}),
      ...(editing && form.clearSecret ? { clearSecret: true } : {}),
    };

    const onSuccess = () => setOpen(false);
    if (editing) {
      updateMutation.mutate(
        {
          id: editing.id,
          data: editing.templateKey
            ? commonPayload
            : {
                ...commonPayload,
                url: form.url.trim(),
                authType: form.authType,
                authHeaderName:
                  form.authType === "custom_header"
                    ? form.authHeaderName.trim()
                    : null,
              },
        },
        { onSuccess },
      );
    } else if (form.templateKey) {
      createTemplateMutation.mutate(
        {
          templateKey: form.templateKey,
          name: commonPayload.name,
          slug: commonPayload.slug,
          description: commonPayload.description,
          ...(form.secret.trim() ? { secret: form.secret.trim() } : {}),
          configuration: selectedTemplate?.defaultConfiguration ?? {},
        },
        { onSuccess },
      );
    } else {
      createMutation.mutate(
        {
          ...commonPayload,
          url: form.url.trim(),
          authType: form.authType,
          authHeaderName:
            form.authType === "custom_header"
              ? form.authHeaderName.trim()
              : null,
        },
        { onSuccess },
      );
    }
  };

  const testConnection = () => {
    setTestResult(null);
    const input = editing && !form.secret.trim()
      ? { id: editing.id }
      : form.templateKey
        ? {
            templateKey: form.templateKey,
            secret: form.secret.trim() || null,
            configuration: selectedTemplate?.defaultConfiguration ?? {},
          }
        : {
            url: form.url.trim(),
            authType: form.authType,
            authHeaderName:
              form.authType === "custom_header"
                ? form.authHeaderName.trim()
                : null,
            secret: form.secret.trim() || null,
          };
    testMutation.mutate(input, { onSuccess: setTestResult });
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Server className="size-6 text-primary" /> MCP
          </h1>
          <p className="text-muted-foreground">
            Your private MCP connectors, with secrets encrypted server-side.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 size-4" /> Add MCP
        </Button>
      </div>

      {templates.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="font-semibold">Popular connectors</h2>
            <p className="text-sm text-muted-foreground">
              Start from a verified provider template or add a custom remote MCP.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {templates.map((template) => {
              const connected = servers.some(
                (server) => server.templateKey === template.key,
              );
              return (
                <div key={template.key} className="rounded-xl border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{template.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {template.description}
                      </p>
                    </div>
                    {connected && (
                      <Badge variant="secondary">
                        <CheckCircle2 className="mr-1 size-3" /> Connected
                      </Badge>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    onClick={() => openTemplate(template)}
                  >
                    {connected ? "Connect another" : `Connect ${template.name}`}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading MCP servers...</p>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={<Server className="size-5" />}
          title="No MCP servers yet"
          description="Add a remote MCP server once, then select it from any agent."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {servers.map((server) => (
            <button
              key={server.id}
              type="button"
              onClick={() => openEdit(server)}
              className="rounded-xl border bg-background p-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{server.name}</h3>
                    <span className="font-mono text-xs text-muted-foreground">{server.slug}</span>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{server.url}</p>
                </div>
                <div className="flex items-center gap-2">
                  {server.hasSecret && <Badge variant="secondary"><KeyRound className="mr-1 size-3" />Secret</Badge>}
                  <Badge variant="outline">{server.authType}</Badge>
                </div>
              </div>
              {server.description && (
                <p className="mt-3 text-sm text-muted-foreground">{server.description}</p>
              )}
            </button>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Edit MCP server"
                : selectedTemplate
                  ? `Connect ${selectedTemplate.name}`
                  : "Add MCP server"}
            </DialogTitle>
            <DialogDescription>
              Secrets are encrypted and never returned to the browser after saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mcp-name">Name</Label>
                <Input
                  id="mcp-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value, slug: current.slug || slugify(event.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-slug">Slug</Label>
                <Input
                  id="mcp-slug"
                  value={form.slug}
                  onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                  className="font-mono"
                />
              </div>
            </div>
            {!form.templateKey && (
              <div className="space-y-2">
                <Label htmlFor="mcp-url">Remote URL</Label>
                <Input
                  id="mcp-url"
                  value={form.url}
                  onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                  placeholder="https://mcp.example.com/mcp"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="mcp-description">Description</Label>
              <Textarea
                id="mcp-description"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="min-h-[72px]"
              />
            </div>
            {!form.templateKey && <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Auth type</Label>
                <Select
                  value={form.authType}
                  onValueChange={(value) => setForm((current) => ({ ...current, authType: value as McpAuthType }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No auth</SelectItem>
                    <SelectItem value="bearer">Bearer token</SelectItem>
                    <SelectItem value="custom_header">Custom header</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.authType === "custom_header" && (
                <div className="space-y-2">
                  <Label htmlFor="mcp-header">Header name</Label>
                  <Input
                    id="mcp-header"
                    value={form.authHeaderName}
                    onChange={(event) => setForm((current) => ({ ...current, authHeaderName: event.target.value }))}
                  />
                </div>
              )}
            </div>}
            {form.authType !== "none" && (
              <div className="space-y-2">
                <Label htmlFor="mcp-secret">
                  {selectedTemplate?.secretLabel ?? "Secret"}{" "}
                  {editing?.hasSecret ? "(leave blank to keep current)" : ""}
                </Label>
                <Input
                  id="mcp-secret"
                  type="password"
                  value={form.secret}
                  onChange={(event) => setForm((current) => ({ ...current, secret: event.target.value }))}
                  placeholder={form.authType === "bearer" ? "token or Bearer token" : "header value"}
                />
              </div>
            )}
            {testResult && (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  testResult.connected
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                }`}
              >
                {testResult.connected
                  ? `Connected to ${testResult.server?.name ?? "MCP server"}. ${testResult.toolCount ?? 0} tools available.`
                  : testResult.error?.message ?? "Connection test failed."}
              </div>
            )}
            {editing?.hasSecret && (
              <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span>Clear stored secret</span>
                <Switch
                  checked={form.clearSecret}
                  onCheckedChange={(checked) => setForm((current) => ({ ...current, clearSecret: checked }))}
                />
              </label>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {editing && (
              <Button
                type="button"
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(editing.id, { onSuccess: () => setOpen(false) })}
              >
                <Trash2 className="mr-2 size-4" /> Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              variant="secondary"
              disabled={testMutation.isPending}
              onClick={testConnection}
            >
              {testMutation.isPending ? "Testing..." : "Test connection"}
            </Button>
            <Button type="button" disabled={isPending} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const AgentPluginsContainer = () => {
  const { data: plugins = [], isLoading } = useAgentPlugins();
  const { data: marketplaces = [], isLoading: marketplacesLoading } =
    usePluginMarketplaces();
  const { data: packages = [], isLoading: packagesLoading } = usePluginPackages();
  const createMutation = useCreateAgentPlugin();
  const updateMutation = useUpdateAgentPlugin();
  const deleteMutation = useDeleteAgentPlugin();
  const addMarketplaceMutation = useAddPluginMarketplace();
  const syncMarketplaceMutation = useSyncPluginMarketplace();
  const deleteMarketplaceMutation = useDeletePluginMarketplace();
  const installMutation = useInstallMarketplacePlugin();
  const uploadMutation = useUploadPluginPackage();
  const [editing, setEditing] = useState<AgentPlugin | null>(null);
  const [open, setOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [marketplaceSource, setMarketplaceSource] = useState("");
  const [marketplaceName, setMarketplaceName] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    instructions: "",
    enabled: true,
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const sortedPlugins = useMemo(() => [...plugins].sort((a, b) => a.name.localeCompare(b.name)), [plugins]);
  const instructionPlugins = sortedPlugins.filter(
    (plugin) => plugin.sourceType === "instructions",
  );
  const installedMarketplaceEntries = new Set(
    packages
      .filter((plugin) => plugin.sourceType === "marketplace")
      .map((plugin) => `${plugin.marketplaceId}:${plugin.externalId}`),
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", slug: "", description: "", instructions: "", enabled: true });
    setOpen(true);
  };

  const openEdit = (plugin: AgentPlugin) => {
    setEditing(plugin);
    setForm({
      name: plugin.name,
      slug: plugin.slug,
      description: plugin.description ?? "",
      instructions: plugin.instructions,
      enabled: plugin.enabled,
    });
    setOpen(true);
  };

  const submit = () => {
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name),
      description: form.description.trim() || null,
      instructions: form.instructions.trim(),
      enabled: form.enabled,
    };
    const onSuccess = () => setOpen(false);
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload }, { onSuccess });
    } else {
      createMutation.mutate(payload, { onSuccess });
    }
  };

  const submitMarketplace = () => {
    addMarketplaceMutation.mutate(
      {
        source: marketplaceSource.trim(),
        name: marketplaceName.trim() || null,
      },
      {
        onSuccess: () => {
          setMarketplaceOpen(false);
          setMarketplaceSource("");
          setMarketplaceName("");
        },
      },
    );
  };

  const submitUpload = () => {
    if (!uploadFile) return;
    uploadMutation.mutate(
      {
        file: uploadFile,
        name: uploadName.trim() || undefined,
        description: uploadDescription.trim() || undefined,
      },
      {
        onSuccess: () => {
          setUploadOpen(false);
          setUploadFile(null);
          setUploadName("");
          setUploadDescription("");
        },
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Plug className="size-6 text-primary" /> Plugins
          </h1>
          <p className="text-muted-foreground">
            Install from a Claude marketplace, upload a private ZIP, or create reusable instructions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setMarketplaceOpen(true)}>
            <Store className="mr-2 size-4" /> Add marketplace
          </Button>
          <Button variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 size-4" /> Upload ZIP
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 size-4" /> Add instructions
          </Button>
        </div>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Installed packages</h2>
          <p className="text-sm text-muted-foreground">
            Private packages available in the agent configuration multiselect.
          </p>
        </div>
        {packagesLoading ? (
          <p className="text-sm text-muted-foreground">Loading packages...</p>
        ) : packages.length === 0 ? (
          <EmptyState
            icon={<Upload className="size-5" />}
            title="No packages installed"
            description="Install one from a marketplace or upload your own ZIP bundle."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {packages.map((plugin) => (
              <div key={plugin.id} className="rounded-xl border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{plugin.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {plugin.description ?? "Private agent package"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{plugin.provider}</Badge>
                    <Badge variant="secondary">{plugin.sourceType}</Badge>
                  </div>
                </div>
                {plugin.version && (
                  <p className="mt-3 font-mono text-xs text-muted-foreground">
                    Version {plugin.version}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Marketplaces</h2>
          <p className="text-sm text-muted-foreground">
            Claude marketplaces are synced server-side and installed in each isolated job.
          </p>
        </div>
        {marketplacesLoading ? (
          <p className="text-sm text-muted-foreground">Loading marketplaces...</p>
        ) : (
          <div className="space-y-3">
            {marketplaces.map((marketplace) => {
              const entries = marketplace.catalog?.plugins ?? [];
              return (
                <div key={marketplace.id} className="rounded-xl border bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{marketplace.name}</h3>
                        {marketplace.isBuiltIn && <Badge>Official</Badge>}
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {marketplace.source}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={syncMarketplaceMutation.isPending}
                        onClick={() => syncMarketplaceMutation.mutate(marketplace.id)}
                      >
                        <RefreshCw className="mr-2 size-3" /> Sync
                      </Button>
                      {!marketplace.isBuiltIn && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteMarketplaceMutation.isPending}
                          onClick={() => deleteMarketplaceMutation.mutate(marketplace.id)}
                        >
                          <Trash2 className="size-3" />
                          <span className="sr-only">Delete {marketplace.name}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                  {entries.length === 0 ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      Sync this marketplace to load its plugin catalog.
                    </p>
                  ) : (
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {entries.map((entry) => {
                        const installed = installedMarketplaceEntries.has(
                          `${marketplace.id}:${entry.externalId}`,
                        );
                        return (
                          <div key={entry.externalId} className="rounded-lg border p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">{entry.name}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {entry.description ?? "Marketplace plugin"}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant={installed ? "secondary" : "outline"}
                                disabled={installed || installMutation.isPending}
                                onClick={() =>
                                  installMutation.mutate({
                                    marketplaceId: marketplace.id,
                                    externalId: entry.externalId,
                                  })
                                }
                              >
                                {installed ? "Installed" : "Install"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Instruction plugins</h2>
          <p className="text-sm text-muted-foreground">
            Lightweight instructions appended to the agent system prompt.
          </p>
        </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading plugins...</p>
      ) : instructionPlugins.length === 0 ? (
        <EmptyState
          icon={<Plug className="size-5" />}
          title="No instruction plugins yet"
          description="Create a plugin for reusable agent behavior, then select it in the agent wizard."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {instructionPlugins.map((plugin) => (
            <button
              key={plugin.id}
              type="button"
              onClick={() => openEdit(plugin)}
              className="rounded-xl border bg-background p-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{plugin.name}</h3>
                    <span className="font-mono text-xs text-muted-foreground">{plugin.slug}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{plugin.description ?? "No description provided."}</p>
                </div>
                <Badge variant={plugin.enabled ? "default" : "outline"}>
                  {plugin.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                {plugin.instructions}
              </p>
            </button>
          ))}
        </div>
      )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit plugin" : "Add plugin"}</DialogTitle>
            <DialogDescription>
              Plugins are prompt instructions. Keep them concrete and action-oriented.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plugin-name">Name</Label>
                <Input
                  id="plugin-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value, slug: current.slug || slugify(event.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plugin-slug">Slug</Label>
                <Input
                  id="plugin-slug"
                  value={form.slug}
                  onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-description">Description</Label>
              <Textarea
                id="plugin-description"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="min-h-[72px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-instructions">Instructions</Label>
              <Textarea
                id="plugin-instructions"
                value={form.instructions}
                onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))}
                className="min-h-[180px] font-mono text-sm"
                placeholder="When this plugin is selected, the agent must..."
              />
            </div>
            <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span>Enabled</span>
              <Switch
                checked={form.enabled}
                onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
              />
            </label>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {editing && (
              <Button
                type="button"
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(editing.id, { onSuccess: () => setOpen(false) })}
              >
                <Trash2 className="mr-2 size-4" /> Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={isPending} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={marketplaceOpen} onOpenChange={setMarketplaceOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Add Claude marketplace</DialogTitle>
            <DialogDescription>
              Use a GitHub owner/repository or a public HTTPS marketplace catalog URL.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="marketplace-source">Source</Label>
              <Input
                id="marketplace-source"
                value={marketplaceSource}
                onChange={(event) => setMarketplaceSource(event.target.value)}
                placeholder="owner/repository"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="marketplace-name">Display name (optional)</Label>
              <Input
                id="marketplace-name"
                value={marketplaceName}
                onChange={(event) => setMarketplaceName(event.target.value)}
              />
            </div>
            {addMarketplaceMutation.error && (
              <p className="text-sm text-destructive">
                {addMarketplaceMutation.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarketplaceOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!marketplaceSource.trim() || addMarketplaceMutation.isPending}
              onClick={submitMarketplace}
            >
              {addMarketplaceMutation.isPending ? "Connecting..." : "Add marketplace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Upload private plugin</DialogTitle>
            <DialogDescription>
              Upload a ZIP containing SKILL.md or a Claude .claude-plugin/plugin.json manifest. Maximum 25 MiB.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="plugin-upload-file">Plugin ZIP</Label>
              <Input
                id="plugin-upload-file"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-upload-name">Display name (optional)</Label>
              <Input
                id="plugin-upload-name"
                value={uploadName}
                onChange={(event) => setUploadName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-upload-description">Description</Label>
              <Textarea
                id="plugin-upload-description"
                value={uploadDescription}
                onChange={(event) => setUploadDescription(event.target.value)}
              />
            </div>
            {uploadMutation.error && (
              <p className="text-sm text-destructive">{uploadMutation.error.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!uploadFile || uploadMutation.isPending}
              onClick={submitUpload}
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload plugin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
