"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Webhook,
  KeyRound,
  Bot,
  Blocks,
  Activity,
  Settings,
  Mail,
  Zap,
  Server,
  GitBranch,
  BrainCircuit,
} from "lucide-react";
import { useFeatureFlag } from "@/lib/feature-flags";
import type { SettingsSection, SettingsSectionGroup } from "../../domain/types";

export const WEBHOOKS_BETA_FLAG = "settings-webhooks-beta";

interface SectionConfig {
  id: string;
  nameKey: string;
  descKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  flagKey?: string;
  isBeta?: boolean;
}

export const sectionConfig: SectionConfig[] = [
  // General
  { id: "general", nameKey: "general", descKey: "generalDesc", href: "/settings/general", icon: Settings, group: "general" },
  { id: "instance", nameKey: "instance", descKey: "instanceDesc", href: "/settings/instance", icon: Server, group: "general" },
  { id: "notifications", nameKey: "notifications", descKey: "notificationsDesc", href: "/settings/notifications", icon: Mail, group: "general" },
  // Integration domains
  { id: "code-providers", nameKey: "codeProviders", descKey: "codeProvidersDesc", href: "/settings/code-providers", icon: GitBranch, group: "integrations" },
  { id: "ai-providers", nameKey: "aiProviders", descKey: "aiProvidersDesc", href: "/settings/ai-providers", icon: BrainCircuit, group: "integrations" },
  { id: "agent-providers", nameKey: "agentProviders", descKey: "agentProvidersDesc", href: "/settings/agent-providers", icon: Bot, group: "integrations" },
  { id: "integrations", nameKey: "otherIntegrations", descKey: "otherIntegrationsDesc", href: "/settings/integrations", icon: Blocks, group: "integrations" },
  { id: "api-keys", nameKey: "apiKeys", descKey: "apiKeysDesc", href: "/settings/api-keys", icon: KeyRound, group: "integrations" },
  { id: "webhooks", nameKey: "webhooks", descKey: "webhooksDesc", href: "/settings/webhooks", icon: Webhook, group: "integrations", flagKey: WEBHOOKS_BETA_FLAG, isBeta: true },
  // AI & Automation
  { id: "usage", nameKey: "usage", descKey: "usageDesc", href: "/settings/usage", icon: Activity, group: "aiAutomation" },
  { id: "orchestration", nameKey: "orchestration", descKey: "orchestrationDesc", href: "/settings/orchestration", icon: Zap, group: "aiAutomation" },
];

const groupOrder = [
  "general",
  "integrations",
  "aiAutomation",
];

export const deriveActiveSection = (pathname: string): string | undefined => {
  // Match against /settings/{sectionId} from the pathname
  const match = pathname.match(/^\/settings\/([^/]+)/);
  if (!match) return "general";

  const segment = match[1];

  // Legacy or provider-specific routes that now belong to a scoped section.
  const codeProviderRedirects = ["github"];
  if (codeProviderRedirects.includes(segment)) return "code-providers";

  const aiProviderRedirects = ["provider-keys", "providers"];
  if (aiProviderRedirects.includes(segment)) return "ai-providers";

  const agentProviderRedirects = ["agents"];
  if (agentProviderRedirects.includes(segment)) return "agent-providers";

  const otherIntegrationRedirects = ["telegram", "vercel"];
  if (otherIntegrationRedirects.includes(segment)) return "integrations";

  // Direct match
  const found = sectionConfig.find((s) => s.id === segment);
  return found ? found.id : undefined;
};

export const useSettingsNavigation = () => {
  const pathname = usePathname();
  const t = useTranslations("settings");

  // Evaluate gated flags (stable hook order — one line per flag)
  const webhooksBetaEnabled = useFeatureFlag(WEBHOOKS_BETA_FLAG);

  const flagResults: Record<string, boolean> = {
    [WEBHOOKS_BETA_FLAG]: webhooksBetaEnabled,
  };

  const activeSection = useMemo(() => deriveActiveSection(pathname), [pathname]);

  const visibleConfig = useMemo(
    () =>
      sectionConfig.filter((s) => {
        if (!s.flagKey) return true;
        return flagResults[s.flagKey] ?? false;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [webhooksBetaEnabled]
  );

  const sections: SettingsSection[] = useMemo(
    () =>
      visibleConfig.map((s) => ({
        id: s.id,
        name: t(`sections.${s.nameKey}`),
        description: t(`sections.${s.descKey}`),
        href: s.href,
        icon: s.icon,
        isBeta: s.isBeta,
      })),
    [t, visibleConfig]
  );

  const groups: SettingsSectionGroup[] = useMemo(() => {
    const sectionsByGroup = new Map<string, SettingsSection[]>();

    for (const config of visibleConfig) {
      const section = sections.find((s) => s.id === config.id);
      if (!section) continue;

      const existing = sectionsByGroup.get(config.group) ?? [];
      existing.push(section);
      sectionsByGroup.set(config.group, existing);
    }

    return groupOrder
      .filter((groupId) => sectionsByGroup.has(groupId))
      .map((groupId) => ({
        id: groupId,
        label: t(`groups.${groupId}`),
        sections: sectionsByGroup.get(groupId)!,
      }));
  }, [sections, t, visibleConfig]);

  const title = t("title");
  const subtitle = t("subtitle");
  const betaLabel = t("betaBadge");

  return {
    sections,
    activeSection,
    groups,
    title,
    subtitle,
    betaLabel,
  };
};
