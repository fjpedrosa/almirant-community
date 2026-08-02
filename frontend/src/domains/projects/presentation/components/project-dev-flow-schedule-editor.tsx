import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CRON_PRESETS } from "@/domains/scheduled-agents/domain/cron-presets";
import { TIMEZONE_OPTIONS } from "@/domains/scheduled-agents/domain/types";
import type { ProjectDevFlowAutomationSchedule } from "../../domain/types";

const INHERIT_TIMEZONE = "__inherit__";

export interface ProjectDevFlowScheduleEditorProps {
  automationName: string;
  /** Current override (null = no schedule override, falls back to `effective`). */
  value: ProjectDevFlowAutomationSchedule | null;
  /** Server-resolved schedule (card default merged with any override) — shown as placeholder/reference. */
  effective: { expression: string; timezone: string };
  disabled?: boolean;
  onChange: (schedule: ProjectDevFlowAutomationSchedule | null) => void;
}

/**
 * Compact schedule override editor for one dev-flow automation row
 * (issue #235): a row of cron presets + a free-text cron expression input +
 * a timezone select. Reuses the scheduled-agents domain's pure
 * `CRON_PRESETS`/`TIMEZONE_OPTIONS` constants rather than duplicating them.
 *
 * Interaction model:
 *  - Clicking a preset overrides the expression, preserving any timezone
 *    override already set.
 *  - Typing a custom expression overrides it directly; clearing the input
 *    entirely clears the WHOLE schedule override back to inherit (the
 *    `${expression}` field is required whenever an override exists).
 *  - Picking a timezone (when there was no override yet) seeds the
 *    expression from `effective.expression` so the user is only changing
 *    the timezone, not silently resetting the cadence.
 */
export const ProjectDevFlowScheduleEditor: React.FC<ProjectDevFlowScheduleEditorProps> = ({
  automationName,
  value,
  effective,
  disabled = false,
  onChange,
}) => {
  const t = useTranslations("projects.devFlow.automationRow");

  const handlePresetSelect = (expression: string) => {
    onChange({ expression, timezone: value?.timezone ?? null });
  };

  const handleExpressionChange = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      onChange(null);
      return;
    }
    onChange({ expression: trimmed, timezone: value?.timezone ?? null });
  };

  const handleTimezoneChange = (tz: string) => {
    if (value === null && tz === INHERIT_TIMEZONE) return;
    const timezone = tz === INHERIT_TIMEZONE ? null : tz;
    const expression = value?.expression ?? effective.expression;
    onChange({ expression, timezone });
  };

  const inputId = `dev-flow-automation-schedule-${automationName.replace(/\s+/g, "-").toLowerCase()}`;
  const activePresetExpression = value?.expression ?? null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
        {t("fields.schedule")}
      </Label>

      <div className="flex flex-wrap gap-1">
        {CRON_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            size="sm"
            variant={activePresetExpression === preset.expression ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            disabled={disabled}
            onClick={() => handlePresetSelect(preset.expression)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <Input
        id={inputId}
        className="h-9 font-mono text-xs"
        value={value?.expression ?? ""}
        placeholder={t("placeholderDefault", { value: effective.expression })}
        disabled={disabled}
        onChange={(e) => handleExpressionChange(e.target.value)}
      />

      <Select
        value={value?.timezone ?? INHERIT_TIMEZONE}
        onValueChange={handleTimezoneChange}
        disabled={disabled}
      >
        <SelectTrigger className="h-9" aria-label={t("scheduleTimezoneLabel")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT_TIMEZONE}>{t("scheduleTimezoneDefault")}</SelectItem>
          {TIMEZONE_OPTIONS.map((tz) => (
            <SelectItem key={tz.value} value={tz.value}>
              {tz.label} ({tz.offset})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
