import { AlertCircle, Moon, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type {
  NightlyValidationProvider,
  ProjectNightlyValidationSettings,
} from "../../domain/types";

const TIMEZONE_OPTIONS = [
  { value: "Europe/Madrid", label: "CET (Madrid)" },
  { value: "Europe/London", label: "GMT (London)" },
  { value: "America/New_York", label: "EST (New York)" },
  { value: "America/Los_Angeles", label: "PST (Los Angeles)" },
  { value: "Asia/Tokyo", label: "JST (Tokyo)" },
  { value: "UTC", label: "UTC" },
];

const PROVIDER_OPTIONS: Array<{
  value: NightlyValidationProvider;
  label: string;
}> = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "zipu", label: "z.ai" },
  { value: "grok", label: "xAI" },
];

const hourToTimeString = (hour: number): string =>
  `${String(hour).padStart(2, "0")}:00`;

const timeStringToHour = (time: string): number =>
  parseInt(time.split(":")[0], 10);

interface ProjectNightlyValidationCardProps {
  settings: ProjectNightlyValidationSettings | null;
  isSaving: boolean;
  hasChanges: boolean;
  errorMessage: string | null;
  onChange: (
    field: keyof ProjectNightlyValidationSettings,
    value: ProjectNightlyValidationSettings[keyof ProjectNightlyValidationSettings]
  ) => void;
  onSave: () => void;
  onDiscard: () => void;
}

export const ProjectNightlyValidationCard: React.FC<ProjectNightlyValidationCardProps> = ({
  settings,
  isSaving,
  hasChanges,
  errorMessage,
  onChange,
  onSave,
  onDiscard,
}) => {
  const isEnabled = settings?.enabled ?? false;
  const isUnavailable = Boolean(errorMessage);
  const isInteractionDisabled = isSaving || isUnavailable;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Moon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Nightly Validation</CardTitle>
            <Badge variant={isEnabled ? "default" : "secondary"} className="text-xs">
              {isEnabled ? "Active" : "Inactive"}
            </Badge>
          </div>
          <Switch
            id="nightly-validation-enabled"
            checked={isEnabled}
            onCheckedChange={(checked) => onChange("enabled", checked)}
            disabled={isInteractionDisabled}
            aria-label="Enable nightly validation"
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <div
          className={`space-y-4 transition-opacity ${
            !isEnabled ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          {/* Schedule row: start - end times */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="nightly-start" className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Start
              </Label>
              <Input
                id="nightly-start"
                type="time"
                value={hourToTimeString(settings?.startHour ?? 1)}
                onChange={(e) => onChange("startHour", timeStringToHour(e.target.value))}
                disabled={!isEnabled || isInteractionDisabled}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nightly-end" className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                End
              </Label>
              <Input
                id="nightly-end"
                type="time"
                value={hourToTimeString(settings?.endHour ?? 6)}
                onChange={(e) => onChange("endHour", timeStringToHour(e.target.value))}
                disabled={!isEnabled || isInteractionDisabled}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nightly-provider" className="text-xs text-muted-foreground">
                Provider
              </Label>
              <Select
                value={settings?.provider ?? "claude-code"}
                onValueChange={(value) =>
                  onChange("provider", value as NightlyValidationProvider)
                }
                disabled={!isEnabled || isInteractionDisabled}
              >
                <SelectTrigger id="nightly-provider" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nightly-timezone" className="text-xs text-muted-foreground">
                Timezone
              </Label>
              <Select
                value={settings?.timezone ?? "Europe/Madrid"}
                onValueChange={(val) => onChange("timezone", val)}
                disabled={!isEnabled || isInteractionDisabled}
              >
                <SelectTrigger id="nightly-timezone" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {isSaving && (
          <p className="text-xs text-muted-foreground">Saving...</p>
        )}
      </CardContent>

      {hasChanges && (
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" size="sm" onClick={onDiscard} disabled={isInteractionDisabled}>
            Discard
          </Button>
          <Button size="sm" onClick={onSave} disabled={isInteractionDisabled}>
            Save Changes
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};
