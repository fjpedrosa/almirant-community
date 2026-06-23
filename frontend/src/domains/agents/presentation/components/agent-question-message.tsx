"use client";

import { Bot, ChevronDown, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Collapsible } from "radix-ui";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentQuestionMessageProps } from "../../domain/types";

const formatTimestamp = (date: string): string => {
  const d = new Date(date);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const QuestionTypeBadge: React.FC<{ type: string; label: string }> = ({
  type,
  label,
}) => (
  <Badge
    variant="outline"
    className={cn(
      "text-xs",
      type === "approval" && "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400",
      type === "choice" && "border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400",
      type === "clarification" && "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400",
      type === "free_text" && "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-400"
    )}
  >
    {label}
  </Badge>
);

const ContextSection: React.FC<{
  context: Record<string, unknown>;
  label: string;
}> = ({ context, label }) => (
  <Collapsible.Root className="mt-2">
    <Collapsible.Trigger className="flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
      <ChevronDown className="h-3 w-3 transition-transform" />
      {label}
    </Collapsible.Trigger>
    <Collapsible.Content className="mt-2">
      <pre className="max-h-48 overflow-auto rounded-md bg-slate-100 p-3 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
        {JSON.stringify(context, null, 2)}
      </pre>
    </Collapsible.Content>
  </Collapsible.Root>
);

const ApprovalActions: React.FC<{
  interactionId: string;
  onRespond: (interactionId: string, answer: string) => void;
  isResponding: boolean;
  yesLabel: string;
  noLabel: string;
}> = ({ interactionId, onRespond, isResponding, yesLabel, noLabel }) => (
  <div className="flex gap-2">
    <Button
      size="sm"
      onClick={() => onRespond(interactionId, "yes")}
      disabled={isResponding}
    >
      {yesLabel}
    </Button>
    <Button
      size="sm"
      variant="outline"
      onClick={() => onRespond(interactionId, "no")}
      disabled={isResponding}
    >
      {noLabel}
    </Button>
  </div>
);

const ChoiceActions: React.FC<{
  interactionId: string;
  options: string[];
  onRespond: (interactionId: string, answer: string) => void;
  isResponding: boolean;
}> = ({ interactionId, options, onRespond, isResponding }) => (
  <div className="flex flex-wrap gap-2">
    {options.map((option) => (
      <Button
        key={option}
        size="sm"
        variant="outline"
        onClick={() => onRespond(interactionId, option)}
        disabled={isResponding}
      >
        {option}
      </Button>
    ))}
  </div>
);

const FreeTextAction: React.FC<{
  interactionId: string;
  onRespond: (interactionId: string, answer: string) => void;
  isResponding: boolean;
  placeholder: string;
  submitLabel: string;
}> = ({ interactionId, onRespond, isResponding, placeholder, submitLabel }) => {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const formData = new FormData(form);
        const text = formData.get("answer") as string;
        if (text.trim()) {
          onRespond(interactionId, text.trim());
          form.reset();
        }
      }}
      className="flex gap-2"
    >
      <Textarea
        name="answer"
        placeholder={placeholder}
        className="min-h-10 resize-none"
        rows={1}
        disabled={isResponding}
      />
      <Button
        type="submit"
        size="sm"
        disabled={isResponding}
        className="shrink-0 self-end"
      >
        <Send className="h-4 w-4" />
        <span className="sr-only">{submitLabel}</span>
      </Button>
    </form>
  );
};

export const AgentQuestionMessage: React.FC<AgentQuestionMessageProps> = ({
  interaction,
  onRespond,
  isResponding = false,
}) => {
  const t = useTranslations("agents.thread");

  const isPending = interaction.status === "pending";
  const questionTypeLabel = t(`questionType.${interaction.questionType}`);

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        isPending
          ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30"
          : "border-border bg-card"
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isPending
            ? "bg-amber-100 dark:bg-amber-900"
            : "bg-slate-100 dark:bg-slate-800"
        )}
      >
        <Bot
          className={cn(
            "h-4 w-4",
            isPending
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground"
          )}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <QuestionTypeBadge
            type={interaction.questionType}
            label={questionTypeLabel}
          />
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(interaction.createdAt)}
          </span>
          {isPending && (
            <Badge className="animate-pulse bg-amber-500 text-xs text-white">
              {t("pending")}
            </Badge>
          )}
        </div>

        <p
          className={cn(
            "text-sm",
            isPending
              ? "font-medium text-amber-900 dark:text-amber-100"
              : "text-foreground"
          )}
        >
          {interaction.questionText}
        </p>

        {interaction.questionContext &&
          Object.keys(interaction.questionContext).length > 0 && (
            <ContextSection
              context={interaction.questionContext}
              label={t("showContext")}
            />
          )}

        {isPending && interaction.questionType === "approval" && (
          <ApprovalActions
            interactionId={interaction.id}
            onRespond={onRespond}
            isResponding={isResponding}
            yesLabel={t("approve")}
            noLabel={t("reject")}
          />
        )}

        {isPending &&
          interaction.questionType === "choice" &&
          interaction.options &&
          interaction.options.length > 0 && (
            <ChoiceActions
              interactionId={interaction.id}
              options={interaction.options}
              onRespond={onRespond}
              isResponding={isResponding}
            />
          )}

        {isPending &&
          (interaction.questionType === "free_text" ||
            interaction.questionType === "clarification") && (
            <FreeTextAction
              interactionId={interaction.id}
              onRespond={onRespond}
              isResponding={isResponding}
              placeholder={t("answerPlaceholder")}
              submitLabel={t("send")}
            />
          )}
      </div>
    </div>
  );
};
