"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type {
  DodHumanActionImpact,
  DodHumanActionOption,
  DodHumanActionV2,
} from "../../domain/dod-human-action";

export interface DodHumanActionPanelProps {
  payload: DodHumanActionV2;
  applyingOptionId?: string | null;
  isSubmitting?: boolean;
  onApply: (optionId: string) => void;
}

const effortLabel = (effort?: DodHumanActionImpact["estimatedEffort"]) => {
  if (!effort) return null;
  const labels: Record<NonNullable<DodHumanActionImpact["estimatedEffort"]>, string> = {
    small: "Small",
    medium: "Medium",
    large: "Large",
  };
  return labels[effort];
};

/**
 * Presentational panel for DodHumanActionV2. Renders the diagnosis +
 * evidence + a card per option. Each option card has an Apply button that
 * calls back into the container.
 *
 * No hooks, no state, no fetch — props in, JSX out.
 */
export const DodHumanActionPanel = ({
  payload,
  applyingOptionId,
  isSubmitting = false,
  onApply,
}: DodHumanActionPanelProps) => {
  const recommendedId = payload.recommendation?.optionId;
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle>Human decision required</AlertTitle>
        <AlertDescription className="whitespace-pre-line text-sm">
          {payload.diagnosis}
        </AlertDescription>
      </Alert>

      {(payload.evidence.conflictingFiles.length > 0 ||
        payload.evidence.relatedFeatures.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Evidence</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-xs">
            {payload.evidence.branchSchema && (
              <DodHumanActionSchemaBlock
                heading="Branch schema"
                snapshot={payload.evidence.branchSchema}
              />
            )}
            {payload.evidence.integratedSchema && (
              <DodHumanActionSchemaBlock
                heading="Integrated schema (main)"
                snapshot={payload.evidence.integratedSchema}
              />
            )}
            {payload.evidence.conflictingFiles.length > 0 && (
              <div>
                <div className="mb-1 font-medium text-muted-foreground">
                  Conflicting files
                </div>
                <ul className="list-disc pl-5">
                  {payload.evidence.conflictingFiles.map((file) => (
                    <li key={file} className="font-mono">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {payload.evidence.relatedFeatures.length > 0 && (
              <div>
                <div className="mb-1 font-medium text-muted-foreground">
                  Related features
                </div>
                <ul className="flex flex-col gap-1">
                  {payload.evidence.relatedFeatures.map((feat) => (
                    <li key={feat.taskId} className="flex items-center gap-2">
                      <Badge variant="outline">{feat.taskId}</Badge>
                      <span>{feat.title}</span>
                      {feat.dodApproved ? (
                        <Badge variant="secondary">DoD approved</Badge>
                      ) : (
                        <Badge variant="outline">DoD pending</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Options
        </h3>
        {payload.options.map((option) => (
          <DodHumanActionOptionCard
            key={option.id}
            option={option}
            isRecommended={option.id === recommendedId}
            recommendationReason={
              option.id === recommendedId
                ? payload.recommendation?.reason
                : undefined
            }
            isApplying={applyingOptionId === option.id && isSubmitting}
            disabled={isSubmitting}
            onApply={() => onApply(option.id)}
          />
        ))}
      </div>
    </div>
  );
};

interface DodHumanActionSchemaBlockProps {
  heading: string;
  snapshot: NonNullable<DodHumanActionV2["evidence"]["branchSchema"]>;
}

const DodHumanActionSchemaBlock = ({
  heading,
  snapshot,
}: DodHumanActionSchemaBlockProps) => (
  <div>
    <div className="mb-1 font-medium text-muted-foreground">{heading}</div>
    <div className="font-mono text-[11px] text-muted-foreground">
      {snapshot.file}
      {snapshot.ref ? <span> @ {snapshot.ref.slice(0, 12)}</span> : null}
    </div>
    {snapshot.columns.length > 0 && (
      <div className="mt-1 flex flex-wrap gap-1">
        {snapshot.columns.map((col) => (
          <Badge key={col} variant="outline" className="font-mono">
            {col}
          </Badge>
        ))}
      </div>
    )}
  </div>
);

interface DodHumanActionOptionCardProps {
  option: DodHumanActionOption;
  isRecommended: boolean;
  recommendationReason?: string;
  isApplying: boolean;
  disabled: boolean;
  onApply: () => void;
}

const DodHumanActionOptionCard = ({
  option,
  isRecommended,
  recommendationReason,
  isApplying,
  disabled,
  onApply,
}: DodHumanActionOptionCardProps) => {
  const effort = effortLabel(option.impact.estimatedEffort);
  return (
    <Card
      className={isRecommended ? "border-primary/60 shadow-sm" : undefined}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">{option.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{option.summary}</p>
        </div>
        {isRecommended && (
          <Badge variant="default">Recommended</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {recommendationReason && (
          <p className="text-xs italic text-muted-foreground">
            {recommendationReason}
          </p>
        )}

        {(option.pros.length > 0 || option.cons.length > 0) && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {option.pros.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
                  Pros
                </div>
                <ul className="list-disc pl-5 text-xs">
                  {option.pros.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {option.cons.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
                  Cons
                </div>
                <ul className="list-disc pl-5 text-xs">
                  {option.cons.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {(effort ||
          option.impact.affectedItems.length > 0 ||
          option.impact.reversible !== undefined) && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {effort && <Badge variant="outline">Effort: {effort}</Badge>}
              {option.impact.reversible !== undefined && (
                <Badge variant="outline">
                  {option.impact.reversible ? "Reversible" : "Not reversible"}
                </Badge>
              )}
              {option.impact.affectedItems.length > 0 && (
                <span className="text-muted-foreground">
                  Affects:{" "}
                  {option.impact.affectedItems.map((id, i) => (
                    <span key={id} className="font-mono">
                      {id}
                      {i < option.impact.affectedItems.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </span>
              )}
              <Badge variant="outline" className="font-mono">
                {option.action.type}
              </Badge>
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={onApply}
            disabled={disabled}
          >
            {isApplying ? "Applying…" : "Apply this option"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
