import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { AiKeyPolicySelectorProps, AiKeyPolicy } from "../../domain/types";

// ---------------------------------------------------------------------------
// Policy option definitions
// ---------------------------------------------------------------------------

interface PolicyOption {
  value: AiKeyPolicy;
  title: string;
  description: string;
}

const POLICY_OPTIONS: PolicyOption[] = [
  {
    value: "org_only",
    title: "Workspace only",
    description:
      "Only workspace-level API keys are used. Personal keys are ignored.",
  },
  {
    value: "org_preferred",
    title: "Workspace preferred",
    description:
      "Workspace keys are used when available, falls back to personal keys.",
  },
  {
    value: "user_preferred",
    title: "Personal preferred",
    description:
      "Personal keys are used when available, falls back to workspace keys.",
  },
  {
    value: "user_only",
    title: "Personal only",
    description:
      "Only personal API keys are used. Workspace keys are ignored.",
  },
];

// ---------------------------------------------------------------------------
// AiKeyPolicySelector - Purely presentational
// ---------------------------------------------------------------------------
// Renders a radio group with the four AI key resolution policies.
// Each option displays a title and a description. The group is disabled
// while a save is in progress.
// ---------------------------------------------------------------------------

export const AiKeyPolicySelector: React.FC<AiKeyPolicySelectorProps> = ({
  value,
  onChange,
  isUpdating,
}) => (
  <RadioGroup
    value={value}
    onValueChange={(v) => onChange(v as AiKeyPolicy)}
    disabled={isUpdating}
    className="grid gap-4"
  >
    {POLICY_OPTIONS.map((option) => (
      <label
        key={option.value}
        htmlFor={`policy-${option.value}`}
        className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
      >
        <RadioGroupItem
          value={option.value}
          id={`policy-${option.value}`}
          className="mt-0.5"
        />
        <div className="grid gap-1">
          <Label
            htmlFor={`policy-${option.value}`}
            className="cursor-pointer font-medium"
          >
            {option.title}
          </Label>
          <p className="text-sm text-muted-foreground leading-snug">
            {option.description}
          </p>
        </div>
      </label>
    ))}
  </RadioGroup>
);
