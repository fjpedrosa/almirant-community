import { useTranslations } from "next-intl";
import { Shuffle, ListOrdered, RotateCcw, Ban, Zap } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  OrchestrationSettingsProps,
  OrchestrationStrategy,
  OrchestrationConnectionInfo,
} from "../../domain/types";

interface StrategyOption {
  value: OrchestrationStrategy | "disabled";
  titleKey: string;
  descKey: string;
  icon: React.ComponentType<{ className?: string }>;
}

const strategyOptions: StrategyOption[] = [
  {
    value: "round_robin",
    titleKey: "roundRobin",
    descKey: "roundRobinDesc",
    icon: Shuffle,
  },
  {
    value: "sequential",
    titleKey: "sequential",
    descKey: "sequentialDesc",
    icon: ListOrdered,
  },
  {
    value: "reset_first",
    titleKey: "resetFirst",
    descKey: "resetFirstDesc",
    icon: RotateCcw,
  },
  {
    value: "disabled",
    titleKey: "disabled",
    descKey: "disabledDesc",
    icon: Ban,
  },
];

function ConnectionStatusBadge({ connection }: { connection: OrchestrationConnectionInfo }) {
  if (connection.suspendedAt) {
    return <Badge variant="destructive">Suspended</Badge>;
  }
  if (!connection.isActive) {
    return <Badge variant="secondary">Inactive</Badge>;
  }
  return <Badge variant="default">Active</Badge>;
}

export const OrchestrationSettings: React.FC<OrchestrationSettingsProps> = ({
  strategy,
  isLoading,
  isSaving,
  connections,
  isLoadingConnections,
  onStrategyChange,
}) => {
  const t = useTranslations("settings.orchestration");

  const currentValue = strategy ?? "disabled";

  const handleValueChange = (value: string) => {
    onStrategyChange(value === "disabled" ? null : (value as OrchestrationStrategy));
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div
      className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]"
      data-testid="orchestration-settings-layout"
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t("title")}</CardTitle>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <RadioGroup
            value={currentValue}
            onValueChange={handleValueChange}
            disabled={isSaving}
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"
            data-testid="orchestration-strategy-grid"
          >
            {strategyOptions.map((option) => {
              const Icon = option.icon;
              const isSelected = currentValue === option.value;

              return (
                <Label
                  key={option.value}
                  htmlFor={`strategy-${option.value}`}
                  className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors hover:bg-accent/50 ${
                    isSelected
                      ? "border-primary bg-accent/30"
                      : "border-border"
                  } ${isSaving ? "opacity-50 pointer-events-none" : ""}`}
                >
                  <RadioGroupItem
                    value={option.value}
                    id={`strategy-${option.value}`}
                    className="mt-0.5"
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {t(option.titleKey)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(option.descKey)}
                    </p>
                  </div>
                </Label>
              );
            })}
          </RadioGroup>

          {isSaving && (
            <p className="text-xs text-muted-foreground">{t("saving")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("connectionsTitle")}</CardTitle>
          <CardDescription>{t("connectionsDescription")}</CardDescription>
        </CardHeader>

        <CardContent>
          {isLoadingConnections ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noConnections")}</p>
          ) : (
            <div className="space-y-2">
              {connections.map((connection) => (
                <div
                  key={connection.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-sm font-medium">{connection.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {connection.provider}
                      </p>
                    </div>
                  </div>
                  <ConnectionStatusBadge connection={connection} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
