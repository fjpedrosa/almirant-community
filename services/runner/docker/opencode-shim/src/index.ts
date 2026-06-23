import { createShimServer } from "@almirant/shim-server";
import { OpenCodeAdapter } from "./opencode-adapter.js";

const host = process.env.OPENCODE_SERVER_HOST ?? "0.0.0.0";
const port = Number(process.env.OPENCODE_SERVER_PORT ?? 4096);

const adapter = new OpenCodeAdapter();
const server = createShimServer({
  adapter,
  host,
  port,
  heartbeatIntervalMs: 15_000,
});

await server.start();

// Start subscribing to the internal OpenCode SSE stream.
// This runs forever (reconnects on failure) — events are forwarded
// to the shim-server's SSE broadcast via adapter.emit().
const abortController = new AbortController();
void adapter.startEventStream(abortController.signal);

const shutdown = async () => {
  abortController.abort();
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
