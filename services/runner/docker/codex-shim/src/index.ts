import { createShimServer } from "@almirant/shim-server";
import { CodexAdapter } from "./codex-adapter.js";

const host = process.env.OPENCODE_SERVER_HOST ?? "0.0.0.0";
const port = Number(process.env.OPENCODE_SERVER_PORT ?? 4096);

const adapter = new CodexAdapter();
const server = createShimServer({
  adapter,
  host,
  port,
  heartbeatIntervalMs: 15_000,
});

await server.start();

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
