"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useRef, useEffect, useState } from "react";
import { Bot, FlaskConical, Sparkles, TerminalSquare } from "lucide-react";
import { motion } from "motion/react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ScheduledAgentsContainer } from "@/domains/scheduled-agents/presentation/containers/scheduled-agents-container";
import { SkillsContainer } from "@/domains/skills/presentation/containers/skills-container";
import { SessionsPageContainer } from "@/domains/sessions/presentation/containers/sessions-page-container";
import { stringifyUrlSearchParams } from "@/domains/shared/application/hooks/use-url-dynamic-filters";

type AgentsTab = "agents" | "skills" | "sessions";
const DEFAULT_TAB: AgentsTab = "sessions";

const TABS: { value: AgentsTab; label: string; icon: React.FC<{ className?: string }>; isBeta?: boolean }[] = [
  { value: "sessions", label: "Sessions", icon: TerminalSquare },
  { value: "agents", label: "Agents", icon: Bot },
  { value: "skills", label: "Skills", icon: Sparkles, isBeta: true },
];

export default function AgentsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTab = (searchParams.get("tab") as AgentsTab) || DEFAULT_TAB;

  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = tabRefs.current.get(activeTab);
      const container = containerRef.current;
      if (el && container) {
        const containerRect = container.getBoundingClientRect();
        const tabRect = el.getBoundingClientRect();
        if (tabRect.width > 0) {
          setIndicator({
            left: tabRect.left - containerRect.left,
            width: tabRect.width,
          });
          return;
        }
      }
      requestAnimationFrame(measure);
    };
    requestAnimationFrame(measure);
  }, [activeTab]);

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === DEFAULT_TAB) {
        params.delete("tab");
      } else {
        params.set("tab", value);
      }
      const queryString = stringifyUrlSearchParams(params);
      router.replace(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [searchParams, router, pathname]
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="flex flex-col h-full"
    >
      <div className="max-w-[1200px] mx-auto w-full px-6 pt-6">
        <div ref={containerRef} className="relative flex gap-6">
          {TABS.map(({ value, label, icon: Icon, isBeta }) => (
            <button
              key={value}
              ref={(el) => {
                if (el) tabRefs.current.set(value, el);
              }}
              type="button"
              onClick={() => handleTabChange(value)}
              className={`flex items-center gap-1.5 pb-2.5 text-sm font-medium transition-colors ${
                activeTab === value
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {isBeta && (
                <span className="inline-flex items-center p-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400">
                  <FlaskConical className="size-2.5" />
                </span>
              )}
            </button>
          ))}
          {indicator && (
            <motion.div
              className="absolute bottom-0 h-0.5 bg-primary rounded-full"
              initial={{ left: indicator.left, width: indicator.width }}
              animate={{ left: indicator.left, width: indicator.width }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
        </div>
      </div>
      <TabsContent value="agents" className="flex-1 mt-0 overflow-hidden">
        <ScheduledAgentsContainer />
      </TabsContent>
      <TabsContent value="skills" className="flex-1 mt-0 overflow-auto">
        <SkillsContainer />
      </TabsContent>
      <TabsContent value="sessions" className="flex-1 mt-0 overflow-auto">
        <SessionsPageContainer />
      </TabsContent>
    </Tabs>
  );
}
