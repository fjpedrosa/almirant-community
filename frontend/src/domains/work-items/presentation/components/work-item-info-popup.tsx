"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { DescriptionErrorBoundary } from "@/domains/shared/presentation/components/description-error-boundary";
import { useTranslations } from "next-intl";
import type { WorkItemInfoPopupProps } from "../../domain/types";

export const WorkItemInfoPopup: React.FC<WorkItemInfoPopupProps> = ({
  title,
  description,
  definitionOfDone,
  definitionOfDoneAvailable = false,
  children,
}) => {
  const t = useTranslations("workItems.form");
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        className="w-72 max-h-[70vh] overflow-y-auto bg-popover text-popover-foreground border rounded-lg p-3 shadow-lg space-y-2"
      >
        <p className="text-[11px] font-semibold">{title}</p>
        {description && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-1">{t("description")}</p>
            <div className="!text-[12px] !leading-[1.35] text-foreground/80 [&_*]:!my-0 [&_*]:!py-0 [&_*]:!text-[12px] [&_*]:!leading-[1.35] [&_ul]:!pl-4 [&_ol]:!pl-4 [&_li]:!my-0.5">
              <DescriptionErrorBoundary key={description} fallbackText={description}>
                <MarkdownPreview content={description} size="xs" />
              </DescriptionErrorBoundary>
            </div>
          </div>
        )}
        {definitionOfDone ? (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-1">{t("definitionOfDone")}</p>
            <div className="!text-[12px] !leading-[1.35] text-foreground/80 [&_*]:!my-0 [&_*]:!py-0 [&_*]:!text-[12px] [&_*]:!leading-[1.35] [&_ul]:!pl-4 [&_ol]:!pl-4 [&_li]:!my-0.5">
              <DescriptionErrorBoundary key={definitionOfDone} fallbackText={definitionOfDone}>
                <MarkdownPreview content={definitionOfDone} size="xs" />
              </DescriptionErrorBoundary>
            </div>
          </div>
        ) : definitionOfDoneAvailable ? (
          // Slim board payload: DoD exists but its content was omitted. Keep the
          // affordance and point to the card's detail view for the full text.
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-1">{t("definitionOfDone")}</p>
            <p className="text-[12px] italic text-muted-foreground">
              {t("definitionOfDoneInDetail")}
            </p>
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
};
