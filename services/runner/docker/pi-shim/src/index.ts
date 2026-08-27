import { createShimServer } from "@almirant/shim-server";
import { PiAdapter } from "./pi-adapter.js";

const host = process.env.SHIM_SERVER_HOST ?? "0.0.0.0";
const port = Number(process.env.SHIM_SERVER_PORT ?? 4096);

const adapter = new PiAdapter();
const server = createShimServer({
  adapter,
  host,
  port,
  heartbeatIntervalMs: 15_000,
});

await server.start();

let shutdownPromise: Promise<void> | null = null;
const shutdown = (): Promise<void> => {
  if (shutdownPromise) return shutdownPromise;
  const stopping = server.stop().finally(() => {
    process.exit(0);
  });
  shutdownPromise = stopping;
  return stopping;
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
