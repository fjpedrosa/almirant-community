"use client";

import { useTranslations } from "next-intl";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import type {
  ParticipantActionSummary,
  WorkItemEventType,
  WorkItemParticipant,
} from "../../domain/types";

interface ParticipantTooltipProps {
  participant: WorkItemParticipant;
  isCreator?: boolean;
  children: React.ReactNode;
}

/** Maps event types to short workflow role labels. */
const roleLabels: Record<WorkItemEventType, string> = {
  created: "Cre\u00f3",
  updated: "Edit\u00f3",
  moved: "Movi\u00f3",
  deleted: "Elimin\u00f3",
  attachment_added: "Adjuntos",
  attachment_removed: "Adjuntos",
  ai_session: "IA",
  comment: "Coment\u00f3",
};

/** Maps event types to full action descriptions. */
const actionLabels: Record<WorkItemEventType, string> = {
  created: "Cre\u00f3 la tarea",
  updated: "Actualiz\u00f3 la tarea",
  moved: "Movi\u00f3 la tarjeta",
  deleted: "Elimin\u00f3 la tarea",
  attachment_added: "Agreg\u00f3 un adjunto",
  attachment_removed: "Quit\u00f3 un adjunto",
  ai_session: "Registr\u00f3 una sesi\u00f3n de IA",
  comment: "Coment\u00f3",
};

/**
 * Derives unique workflow role labels from a participant's action list.
 * Deduplicates roles that share the same label (e.g. attachment_added and
 * attachment_removed both map to "Adjuntos").
 */
const deriveRoles = (actions: ParticipantActionSummary[]): string[] => {
  const seen = new Set<string>();
  const roles: string[] = [];

  for (const action of actions) {
    const label = roleLabels[action.eventType] ?? action.eventType;
    if (!seen.has(label)) {
      seen.add(label);
      roles.push(label);
    }
  }

  return roles;
};

const formatActionLabel = (action: ParticipantActionSummary): string => {
  const base = actionLabels[action.eventType] ?? action.eventType;
  return action.count > 1 ? `${base} x${action.count}` : base;
};

export const ParticipantTooltip: React.FC<ParticipantTooltipProps> = ({
  participant,
  isCreator = false,
  children,
}) => {
  const t = useTranslations("workItems");
  const { formatRelative } = useFormattedDate();
  const sortedActions = [...participant.actions].sort(
    (a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime()
  );
  const roles = deriveRoles(sortedActions);
  const relativeTime = formatRelative(participant.lastActionDate);

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs space-y-1.5 py-2">
        {/* Name */}
        <p className="text-xs font-semibold">{participant.userName ?? "Usuario"}</p>

        {isCreator && (
          <span className="inline-flex items-center rounded-full bg-violet-500/20 px-1.5 py-px text-[10px] font-medium leading-tight text-violet-700 dark:text-violet-100">
            {t("card.creator")}
          </span>
        )}

        {/* Role badges */}
        {roles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {roles.map((role) => (
              <span
                key={role}
                className="inline-flex items-center rounded-full bg-primary-foreground/15 px-1.5 py-px text-[10px] font-medium leading-tight text-primary-foreground"
              >
                {role}
              </span>
            ))}
          </div>
        )}

        {/* Relative time */}
        <p className="text-[11px] text-primary-foreground/70">
          Ultima acci\u00f3n {relativeTime}
        </p>

        {/* Separator */}
        <Separator className="bg-primary-foreground/20" />

        {/* Detailed action list */}
        <div className="space-y-0.5">
          {sortedActions.map((action) => (
            <p
              key={`${action.eventType}-${action.lastDate}`}
              className="text-[11px] text-primary-foreground/80"
            >
              {formatActionLabel(action)}
            </p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
