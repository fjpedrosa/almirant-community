export type MockDockerContainer = {
  id: string;
  started: boolean;
  stopped: boolean;
  logs: string[];
};

export const createMockDockerContainer = (
  partial: Partial<MockDockerContainer> = {}
): MockDockerContainer => ({
  id: partial.id ?? "container-1",
  started: partial.started ?? false,
  stopped: partial.stopped ?? false,
  logs: partial.logs ?? [],
});

export type MockDiscordMessage = {
  id: string;
  content: string;
};

export type MockDiscordThread = {
  id: string;
  name: string;
  archived: boolean;
  messages: MockDiscordMessage[];
};

export const createMockDiscordThread = (
  partial: Partial<MockDiscordThread> = {}
): MockDiscordThread => ({
  id: partial.id ?? "thread-1",
  name: partial.name ?? "remote-agent-test",
  archived: partial.archived ?? false,
  messages: partial.messages ?? [],
});

export type MockWorkerApiClient = {
  updateJobStatusCalls: Array<{ jobId: string; status: string }>;
};

export const createMockWorkerApiClient = (): MockWorkerApiClient => ({
  updateJobStatusCalls: [],
});
