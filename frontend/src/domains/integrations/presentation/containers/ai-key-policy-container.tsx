"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiKeyPolicy } from "../../application/hooks/use-ai-key-policy";
import { AiKeyPolicySelector } from "../components/ai-key-policy-selector";

// ---------------------------------------------------------------------------
// AiKeyPolicyContainer
// ---------------------------------------------------------------------------
// Wires the useAiKeyPolicy hook to the presentational AiKeyPolicySelector.
// Wraps everything in a Card with a descriptive header.
// ---------------------------------------------------------------------------

export const AiKeyPolicyContainer: React.FC = () => {
  const { currentPolicy, isLoading, isUpdating, updatePolicy } =
    useAiKeyPolicy();

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Key Policy</CardTitle>
        <CardDescription>
          Control how AI provider keys are resolved across the workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] rounded-lg" />
            ))}
          </div>
        ) : (
          <AiKeyPolicySelector
            value={currentPolicy}
            onChange={updatePolicy}
            isUpdating={isUpdating}
          />
        )}
      </CardContent>
    </Card>
  );
};
