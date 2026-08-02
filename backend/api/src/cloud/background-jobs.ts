/**
 * Downstream distributions may replace this module to start cloud-only
 * background jobs (e.g. feedback-cluster investigation sweeps, scaler
 * demand publication) alongside community's own `background.ts` jobs.
 *
 * Community keeps the default implementation inert: it starts nothing and
 * returns a no-op stop handle, so composing it into `startBackgroundJobs()`
 * changes no observable behavior.
 */
export type StopCloudBackgroundJobs = () => void | Promise<void>;

export const startCloudBackgroundJobs = (): StopCloudBackgroundJobs => () => {};
