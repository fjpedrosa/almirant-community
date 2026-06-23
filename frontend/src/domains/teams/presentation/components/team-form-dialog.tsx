import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TeamFormDialogProps } from "../../domain/types";

export const TeamFormDialog: React.FC<TeamFormDialogProps> = ({
  isOpen,
  name,
  slug,
  isSubmitting,
  onNameChange,
  onSlugChange,
  onSubmit,
  onClose,
}) => {
  const t = useTranslations("teams");
  const isEdit = !!name;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("editTeam") : t("createTeam")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t("editTeamDescription") : t("createTeamDescription")}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="team-name">{t("form.name")} *</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t("form.namePlaceholder")}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="team-slug">{t("form.slug")}</Label>
            <Input
              id="team-slug"
              value={slug}
              onChange={(e) => onSlugChange(e.target.value)}
              placeholder={t("form.slugPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("form.slugHint")}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting
                ? t("saving")
                : isEdit
                  ? t("saveChanges")
                  : t("createTeam")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
