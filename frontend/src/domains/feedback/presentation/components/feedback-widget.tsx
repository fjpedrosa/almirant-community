import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { FeedbackForm } from "./feedback-form";
import type { FeedbackWidgetProps } from "../../domain/types";

export function FeedbackWidget({
  isOpen,
  isMobile,
  isPending,
  isSuccess,
  isCapturingScreenshot,
  error,
  category,
  message,
  email,
  onOpenChange,
  onCategoryChange,
  onMessageChange,
  onEmailChange,
  onSubmit,
}: FeedbackWidgetProps) {
  const t = useTranslations("feedbackWidget");

  const formContent = (
    <FeedbackForm
      category={category}
      message={message}
      email={email}
      isPending={isPending}
      isSuccess={isSuccess}
      isCapturingScreenshot={isCapturingScreenshot}
      error={error}
      onCategoryChange={onCategoryChange}
      onMessageChange={onMessageChange}
      onEmailChange={onEmailChange}
      onSubmit={onSubmit}
      onClose={() => onOpenChange(false)}
    />
  );

  return (
    <>
      {/* Desktop: tab hanging from the top bar's top edge, in-flow inside
          the bar's right-hand cluster next to the notification icons (see
          `top-navigation-bar.tsx`). Deliberately NOT `fixed`/`absolute`: the
          previous version hung from the window's top edge at
          `right-[168px]`, a hand-measured guess at the width of that
          cluster — and both the pending-questions and usage buttons render
          conditionally, so the gap it aimed for is not a constant. Instead,
          this button is a normal flex child and the wrapping cluster in
          `top-navigation-bar.tsx` is `items-start` (while the rest of the
          bar stays `items-center`), which pins the button's top to the
          bar's top edge — the same "hangs from the edge" look, anchored by
          layout instead of a measurement.

          Breakpoints are measured, not guessed. From `md` (768px) up to
          `lg` (1024px) the top bar's central nav collapses into the sidebar
          hamburger menu (see `top-navigation-bar.tsx`), which frees up
          exactly the room this tab needs — so it appears from `md` too. On
          mobile it stays hidden and feedback opens from the sidebar menu
          instead. */}
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        data-feedback-widget-trigger=""
        className="hidden md:block bg-primary text-primary-foreground px-3 py-0.5 rounded-b-md hover:py-1.5 transition-all"
        aria-label={t("triggerLabel")}
      >
        <span className="text-sm font-medium">{t("tabLabel")}</span>
      </button>

      {/* Mobile: hidden — feedback is accessible from the mobile sidebar menu,
          whose button dispatches the `open-feedback` event this widget's hook
          listens for. */}

      {/* Desktop: Dialog */}
      {!isMobile && (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
          <DialogContent
            data-feedback-widget-content=""
            className="sm:max-w-md"
          >
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            {formContent}
          </DialogContent>
        </Dialog>
      )}

      {/* Mobile: Sheet from bottom */}
      {isMobile && (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
          <SheetContent
            data-feedback-widget-content=""
            side="bottom"
            className="rounded-t-xl"
          >
            <SheetHeader>
              <SheetTitle>{t("title")}</SheetTitle>
              <SheetDescription>{t("description")}</SheetDescription>
            </SheetHeader>
            <div className="pt-4">{formContent}</div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
