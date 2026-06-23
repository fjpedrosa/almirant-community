"use client";

import type React from "react";
import { useInstanceVersion } from "../../application/hooks/use-instance-version";
import { useInstanceUpdate } from "../../application/hooks/use-instance-update";
import { VersionUpdateBanner } from "../components/version-update-banner";
import { UpdateProgressModal } from "../components/update-progress-modal";

/**
 * Resolve a sensible default SSH host suggestion for the copy-command based
 * on window.location.hostname. If the instance is served over a Tailscale
 * MagicDNS name (`*.ts.net`), use the machine segment so the user can paste
 * directly. Otherwise, fall back to a placeholder.
 */
const deriveSshHostHint = (): string | null => {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  if (!host) return null;

  // Tailscale MagicDNS: <machine>.<tailnet>.ts.net  → use <machine>
  if (host.endsWith(".ts.net")) {
    const parts = host.split(".");
    if (parts.length >= 3) return parts[0] ?? null;
  }

  // localhost / *.local / IPs → can't guess, leave empty
  if (host === "localhost" || host.endsWith(".local") || /^\d+\./.test(host)) {
    return null;
  }

  // Custom domain: best guess is the hostname itself
  return host;
};

export const VersionUpdateBannerContainer: React.FC = () => {
  const { info, shouldShowBanner, dismiss } = useInstanceVersion();
  const update = useInstanceUpdate(info);

  if (!shouldShowBanner || !info) return null;

  // The "Update now" CTA is only wired when the sidecar is actually
  // reachable. Otherwise we pass undefined and the banner falls back to
  // its existing copy-command UX (no breaking change for old installs).
  const onUpdateNow = update.isUpdaterAvailable
    ? update.triggerUpdate
    : undefined;

  return (
    <>
      <VersionUpdateBanner
        current={info.current}
        latest={info.latest}
        compareUrl={info.compareUrl}
        sshHostHint={deriveSshHostHint()}
        onDismiss={dismiss}
        onUpdateNow={onUpdateNow}
      />
      <UpdateProgressModal
        view={update.view === "idle" ? "hidden" : update.view}
        current={info.current}
        latest={info.latest}
        job={update.job}
        errorMessage={update.errorMessage}
        onConfirm={update.onConfirm}
        onCancel={update.onCancel}
        onReload={update.onReload}
        onRetry={update.onRetry}
        onDismiss={update.onDismiss}
      />
    </>
  );
};
