import { Alert, AlertTitle } from "@/components/ui/alert";
import { Loader2, ExternalLink } from "lucide-react";

export interface ClusterDetailPrMergedBannerProps {
  mergedAt: string;
  prUrl: string | null;
  now: Date;
}

const formatRelative = (iso: string, now: Date): string => {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return iso;
  const diffMs = target - now.getTime();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absMs < minute) return rtf.format(Math.round(diffMs / 1000), "second");
  if (absMs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (absMs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  return rtf.format(Math.round(diffMs / day), "day");
};

/**
 * Banner shown at the top of the cluster detail hero when a PR linked to the
 * active attempt has just been merged and the cluster has transitioned to
 * `resolved`. Gate logic lives in `shouldShowPrMergedBanner`; this component
 * is purely presentational and assumes the caller already decided to render it.
 */
export const ClusterDetailPrMergedBanner: React.FC<
  ClusterDetailPrMergedBannerProps
> = ({ mergedAt, prUrl, now }) => {
  const relative = formatRelative(mergedAt, now);
  return (
    <Alert className="border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>PR mergeado {relative} — validación en curso</span>
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-normal underline underline-offset-2 hover:opacity-80"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Ver PR
          </a>
        )}
      </AlertTitle>
    </Alert>
  );
};
