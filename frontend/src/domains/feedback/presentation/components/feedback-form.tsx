import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { FeedbackFormProps, FeedbackWidgetCategory } from "../../domain/types";

const CATEGORIES: { value: FeedbackWidgetCategory; labelKey: string }[] = [
  { value: "bug", labelKey: "categoryBug" },
  { value: "feature_request", labelKey: "categoryFeature" },
  { value: "improvement", labelKey: "categoryUiUx" },
  { value: "other", labelKey: "categoryGeneral" },
];

export function FeedbackForm({
  category,
  message,
  email,
  isPending,
  isSuccess,
  isCapturingScreenshot,
  error,
  onCategoryChange,
  onMessageChange,
  onEmailChange,
  onSubmit,
  onClose,
}: FeedbackFormProps) {
  const t = useTranslations("feedbackWidget");

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <CheckCircle2 className="h-10 w-10 text-green-500" />
        <p className="text-sm font-medium text-foreground">
          {t("successMessage")}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="feedback-category">{t("categoryLabel")}</Label>
        <Select
          value={category}
          onValueChange={(val) => onCategoryChange(val as FeedbackWidgetCategory)}
        >
          <SelectTrigger id="feedback-category">
            <SelectValue placeholder={t("categoryPlaceholder")} />
          </SelectTrigger>
          <SelectContent data-feedback-category-content="">
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {t(cat.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="feedback-message">{t("messageLabel")}</Label>
        <Textarea
          id="feedback-message"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder={t("messagePlaceholder")}
          rows={4}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="feedback-email">
          {t("emailLabel")}{" "}
          <span className="text-muted-foreground text-xs">
            ({t("emailOptional")})
          </span>
        </Label>
        <Input
          id="feedback-email"
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder={t("emailPlaceholder")}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={isCapturingScreenshot || isPending || !message.trim()}>
          {isCapturingScreenshot ? t("capturing") : isPending ? t("sending") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
