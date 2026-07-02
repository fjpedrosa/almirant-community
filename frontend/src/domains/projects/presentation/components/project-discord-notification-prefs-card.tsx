import { Bell, BellOff, Building2, Settings2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import type { ProjectDiscordNotificationPrefsCardProps } from "../../domain/types";

export const ProjectDiscordNotificationPrefsCard: React.FC<
  ProjectDiscordNotificationPrefsCardProps
> = ({
  isConnected,
  isInheriting,
  categories,
  formState,
  isLoading,
  isSaving,
  hasChanges,
  onToggle,
  onMasterToggle,
  onSave,
  onDiscard,
  onToggleInherit,
}) => {
  if (!isConnected) {
    return null;
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">
              Discord Notification Preferences
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Loading preferences...
          </p>
        </CardContent>
      </Card>
    );
  }

  const isDisabled = isSaving || isInheriting;

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
            <CardTitle className="text-base">
              Discord Notification Preferences
            </CardTitle>
            {isInheriting ? (
              <Badge variant="secondary" className="ml-2 text-xs">
                <Building2 className="mr-1 h-3 w-3" />
                Using workspace defaults
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2 text-xs">
                <Settings2 className="mr-1 h-3 w-3" />
                Project override
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isInheriting && (
              <>
                <Label
                  htmlFor="project-master-toggle"
                  className="text-xs text-muted-foreground"
                >
                  {formState.enabled ? "Enabled" : "Disabled"}
                </Label>
                <Switch
                  id="project-master-toggle"
                  checked={formState.enabled}
                  onCheckedChange={(checked) => onMasterToggle(checked)}
                  disabled={isSaving}
                />
              </>
            )}
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
                    htmlFor={`project-${toggle.key}`}
                    className="text-sm font-normal text-muted-foreground cursor-pointer"
                  >
                    {toggle.label}
                  </Label>
                  <Switch
                    id={`project-${toggle.key}`}
                    checked={formState[toggle.key]}
                    onCheckedChange={(checked) => onToggle(toggle.key, checked)}
                    disabled={isDisabled || !formState.enabled}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>

      <CardFooter className="flex justify-between border-t pt-4">
        <div>
          {isInheriting ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleInherit}
              disabled={isSaving}
            >
              Customize
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleInherit}
              disabled={isSaving}
              className="text-muted-foreground"
            >
              Revert to workspace defaults
            </Button>
          )}
        </div>
        {!isInheriting && hasChanges && (
          <div className="flex gap-2">
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
          </div>
        )}
      </CardFooter>
    </Card>
  );
};
