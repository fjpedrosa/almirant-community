export type JobStatus = "queued" | "running" | "success" | "failed";

export type JobStep =
  | "fetching"
  | "building"
  | "recreating"
  | "healthchecking"
  | "preparing"
  | "applying"
  | "stopping"
  | "cleaning"
  | "restarting"
  | "done";

export type LogSource = "stdout" | "stderr" | "system";

export interface JobLogLine {
  timestamp: string;
  source: LogSource;
  text: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  step: JobStep | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  logTail: JobLogLine[];
  fromSha: string | null;
  toSha: string | null;
  errorMessage: string | null;
}

export interface SpawnResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}
