import type { ClusterLifecyclePhase } from "./types";

export interface LaunchButtonState {
  visible: boolean;
  label: string;
  disabledReason: string | null;
  highlight: boolean;
}

/**
 * Derives the launch CTA state from the cluster lifecycle phase, the presence
 * of an active attempt and the upstream `canLaunch` flag.
 *
 * Regression phase MUST keep `highlight: true` so the UI emphasises the action.
 * Dismissed / promoted phases MUST keep `visible: false` so the CTA never
 * appears on terminal clusters.
 */
export const deriveLaunchButtonState = (
  phase: ClusterLifecyclePhase,
  hasActiveAttempt: boolean,
  canLaunch: boolean
): LaunchButtonState => {
  switch (phase) {
    case "open":
      return {
        visible: true,
        label: "Lanzar investigación",
        disabledReason: canLaunch ? null : "No se puede lanzar la investigación",
        highlight: false,
      };
    case "investigating":
      return {
        visible: true,
        label: "Lanzar investigación",
        disabledReason: hasActiveAttempt
          ? "Ya hay un intento en curso"
          : canLaunch
            ? null
            : "No se puede lanzar la investigación",
        highlight: false,
      };
    case "fix_ready":
      return {
        visible: true,
        label: "Lanzar nuevo intento",
        disabledReason: canLaunch ? null : "No se puede lanzar un nuevo intento",
        highlight: false,
      };
    case "resolved":
      return {
        visible: true,
        label: "Reabrir investigación",
        disabledReason: canLaunch ? null : "No se puede reabrir la investigación",
        highlight: false,
      };
    case "regression":
      return {
        visible: true,
        label: "Lanzar nuevo intento",
        disabledReason: canLaunch ? null : "No se puede lanzar un nuevo intento",
        highlight: true,
      };
    case "dismissed":
    case "promoted":
      return {
        visible: false,
        label: "",
        disabledReason: null,
        highlight: false,
      };
  }
};
