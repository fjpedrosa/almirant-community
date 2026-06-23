import { Bell, BellOff } from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { DiscordNotificationPrefsPanelProps } from "../../domain/types";

export const DiscordNotificationPrefsPanel: React.FC<
  DiscordNotificationPrefsPanelProps
> = ({
  categories,
  formState,
  isLoading,
  isSaving,
  hasChanges,
  onToggle,
  onMasterToggle,
  onSave,
  onDiscard,
}) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Notification Preferences</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading preferences...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {formState.enabled ? (
              <Bell className="h-4 w-4 text-muted-foreground" />
            ) : (
              <BellOff className="h-4 w-4 text-muted-foreground" />
            )}
            <CardTitle className="text-base">Notification Preferences</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Label
              htmlFor="master-toggle"
              className="text-xs text-muted-foreground"
            >
              {formState.enabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id="master-toggle"
              checked={formState.enabled}
              onCheckedChange={(checked) => onMasterToggle(checked)}
              disabled={isSaving}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {categories.map((category, idx) => (
          <div key={category.name}>
            {idx > 0 && <Separator className="mb-4" />}
            <h4 className="text-sm font-medium mb-3">{category.name}</h4>
            <div className="space-y-3">
              {category.toggles.map((toggle) => (
                <div
                  key={toggle.key}
                  className="flex items-center justify-between"
                >
                  <Label
                    htmlFor={toggle.key}
                    className="text-sm font-normal text-muted-foreground cursor-pointer"
                  >
                    {toggle.label}
                  </Label>
                  <Switch
                    id={toggle.key}
                    checked={formState[toggle.key]}
                    onCheckedChange={(checked) => onToggle(toggle.key, checked)}
                    disabled={isSaving || !formState.enabled}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>

      {hasChanges && (
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onDiscard}
            disabled={isSaving}
          >
            Discard
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            Save Changes
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};
