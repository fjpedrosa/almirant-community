import { runTaskId } from "./runner.js";

export const runSingleTask = async (taskId: string): Promise<void> => {
  const ok = await runTaskId(taskId);
  process.exitCode = ok ? 0 : 1;
};
