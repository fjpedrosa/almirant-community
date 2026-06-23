"use client";

import type React from "react";
import { useState } from "react";
import { ArrowUpCircle, ExternalLink, X, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VersionUpdateBannerProps } from "../../domain/instance-version-types";

export const VersionUpdateBanner: React.FC<VersionUpdateBannerProps> = ({
  current,
  latest,
  compareUrl,
  sshHostHint,
  onDismiss,
  onUpdateNow,
}) => {
  const [copied, setCopied] = useState(false);
  const hostArg = sshHostHint ?? "<your-ssh-host>";
  const updateCommand = `./scripts/update-remote.sh ${hostArg}`;

  const handleCopy = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(updateCommand).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-sm"
    >
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden />

      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">A new Almirant version is available.</span>
        <span className="text-muted-foreground">
          {current ?? "unknown"} → {latest}
        </span>
        <a
          href={compareUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          View changes <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>

      {onUpdateNow ? (
        <Button
          size="sm"
          onClick={onUpdateNow}
          className="shrink-0"
          aria-label="Update Almirant now"
        >
          <ArrowUpCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
          Update now
        </Button>
      ) : (
        <>
          <code className="hidden max-w-[40%] truncate rounded bg-muted px-2 py-1 font-mono text-xs md:inline">
            {updateCommand}
          </code>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="shrink-0"
            aria-label="Copy update command"
          >
            {copied ? (
              <>
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
                Copy command
              </>
            )}
          </Button>
        </>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        aria-label="Dismiss update notification"
        className="shrink-0"
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
};
