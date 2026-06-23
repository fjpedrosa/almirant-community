import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, User } from "lucide-react";
import type {
  AiScopeSelectorProps,
  ConnectionScope,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// AiScopeSelector - Purely presentational
// ---------------------------------------------------------------------------
// Toggle AI connection scope between workspace (organization) and personal.
// Uses shadcn/ui Tabs as a visual toggle.
// ---------------------------------------------------------------------------

export const AiScopeSelector: React.FC<AiScopeSelectorProps> = ({
  value,
  onChange,
}) => (
  <Tabs
    value={value}
    onValueChange={(v) => onChange(v as ConnectionScope)}
  >
    <TabsList>
      <TabsTrigger value="organization">
        <Building2 className="size-3.5" />
        <span>Workspace</span>
      </TabsTrigger>
      <TabsTrigger value="user">
        <User className="size-3.5" />
        <span>Personal</span>
      </TabsTrigger>
    </TabsList>
  </Tabs>
);
