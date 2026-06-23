import { DollarSign } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { UtilizationMeter } from "./utilization-meter";
import { computeExpectedPercent } from "../../domain/formatters";
import type { OAuthProviderStatus, OAuthUsageDisplayProps } from "../../domain/types";

const toPercent = (utilization: number): number => {
  return utilization <= 1 ? utilization * 100 : utilization;
};

const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

const PACING_THRESHOLD = 2;

const computePacingLabel = (
  percent: number,
  expectedPercent: number,
  onPace: string,
  inReservoir: (diff: number) => string,
  deficit: (diff: number) => string,
): string => {
  const diff = Math.abs(Math.round(percent - expectedPercent));
  if (diff <= PACING_THRESHOLD) return onPace;
  if (percent < expectedPercent) return inReservoir(diff);
  return deficit(diff);
};

const formatPlanLabel = (planType: string | null): string => {
  if (!planType) return "ChatGPT";
  return `ChatGPT ${planType.charAt(0).toUpperCase()}${planType.slice(1)}`;
};

const formatStatusLabel = (status: OAuthProviderStatus): string => {
  if (status.limitReached) return "Limit reached";
  if (status.allowed === false) return "Unavailable";
  return "Available";
};

export const OAuthUsageDisplay: React.FC<OAuthUsageDisplayProps> = ({ oauthUsage, timers }) => {
  const t = useTranslations("providerUsagePanel");
  const {
    fiveHour,
    sevenDay,
    sevenDayOpus,
    sevenDaySonnet,
    extraUsage,
    providerStatus,
  } = oauthUsage;

  const sevenDayExpected = sevenDay ? computeExpectedPercent(sevenDay.resetsAt, SEVEN_DAY_MS) : undefined;
  const opusExpected = sevenDayOpus ? computeExpectedPercent(sevenDayOpus.resetsAt, SEVEN_DAY_MS) : undefined;
  const sonnetExpected = sevenDaySonnet ? computeExpectedPercent(sevenDaySonnet.resetsAt, SEVEN_DAY_MS) : undefined;

  const onPaceStr = t("onPace");
  const inReservoirFn = (diff: number) => t("inReservoir", { percent: diff });
  const deficitFn = (diff: number) => t("deficit", { percent: diff });

  return (
    <div className="space-y-3">
      {providerStatus && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{formatPlanLabel(providerStatus.planType)}</span>
          <Badge
            variant={providerStatus.limitReached ? "destructive" : "outline"}
            className="h-4 px-1.5 text-[10px]"
          >
            {formatStatusLabel(providerStatus)}
          </Badge>
        </div>
      )}

      <div className="space-y-2">
        {fiveHour && (
          <UtilizationMeter
            label={t("sessionWindow")}
            percent={toPercent(fiveHour.utilization)}
            formattedTimeLeft={timers.fiveHour.formattedTimeLeft}
            isExpired={timers.fiveHour.isExpired}
          />
        )}
        {sevenDay && (
          <UtilizationMeter
            label={t("weeklyWindow")}
            percent={toPercent(sevenDay.utilization)}
            formattedTimeLeft={timers.sevenDay.formattedTimeLeft}
            isExpired={timers.sevenDay.isExpired}
            expectedPercent={sevenDayExpected}
            pacingLabel={sevenDayExpected !== undefined ? computePacingLabel(toPercent(sevenDay.utilization), sevenDayExpected, onPaceStr, inReservoirFn, deficitFn) : undefined}
          />
        )}
        {sevenDayOpus && (
          <UtilizationMeter
            label={t("opusWeeklyWindow")}
            percent={toPercent(sevenDayOpus.utilization)}
            formattedTimeLeft={timers.sevenDayOpus.formattedTimeLeft}
            isExpired={timers.sevenDayOpus.isExpired}
            expectedPercent={opusExpected}
            pacingLabel={opusExpected !== undefined ? computePacingLabel(toPercent(sevenDayOpus.utilization), opusExpected, onPaceStr, inReservoirFn, deficitFn) : undefined}
          />
        )}
        {sevenDaySonnet && (
          <UtilizationMeter
            label={t("sonnetWeeklyWindow")}
            percent={toPercent(sevenDaySonnet.utilization)}
            formattedTimeLeft={timers.sevenDaySonnet.formattedTimeLeft}
            isExpired={timers.sevenDaySonnet.isExpired}
            expectedPercent={sonnetExpected}
            pacingLabel={sonnetExpected !== undefined ? computePacingLabel(toPercent(sevenDaySonnet.utilization), sonnetExpected, onPaceStr, inReservoirFn, deficitFn) : undefined}
          />
        )}
      </div>

      {extraUsage.isEnabled && (
        <div className="rounded-md border bg-muted/30 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <DollarSign className="h-3 w-3" />
            <span>Extra Usage</span>
          </div>
          <UtilizationMeter
            // Anthropic returns usedCredits/monthlyLimit in minor units (cents).
            label={`${(extraUsage.usedCredits / 100).toFixed(2)} / ${(extraUsage.monthlyLimit / 100).toFixed(2)} ${extraUsage.currency}`}
            percent={toPercent(extraUsage.utilization)}
            warningThreshold={60}
            criticalThreshold={85}
          />
        </div>
      )}
    </div>
  );
};
