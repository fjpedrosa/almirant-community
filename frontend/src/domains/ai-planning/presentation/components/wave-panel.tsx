import { Loader2, CheckCircle2, XCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WavePanelProps } from "../../domain/types";

// Presentational: renders the live specialist-agent wave (agent.wave.* signals).
// Props in, JSX out — all state comes from the planning session hook.

export const WavePanel: React.FC<WavePanelProps> = ({ waveInfo }) => {
  if (!waveInfo || waveInfo.agents.length === 0) return null;

  const { agents, successCount, totalCount } = waveInfo;

  return (
    <div className="mx-2 my-2 rounded-lg border bg-muted/20 p-3">
      {/* Header: wave summary */}
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Layers className="size-4" />
        <span>Wave</span>
        <span className="ml-auto tabular-nums">
          {successCount}/{totalCount}
        </span>
      </div>

      {/* Agent rows */}
      <ul className="flex flex-col gap-1.5">
        {agents.map((agent) => {
          const running = !agent.done;
          const failed = agent.done && agent.success === false;

          return (
            <li
              key={agent.id}
              className="flex items-center gap-2 text-sm"
            >
              <span className="shrink-0">
                {running ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : failed ? (
                  <XCircle className="size-3.5 text-destructive" />
                ) : (
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                )}
              </span>
              <span
                className={cn(
                  "truncate",
                  running && "text-foreground",
                  agent.done && agent.success && "text-muted-foreground",
                  failed && "text-destructive",
                )}
              >
                {agent.name}
              </span>
              <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                {agent.role}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
