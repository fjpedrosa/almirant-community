import { getAuth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";

// Dynamic handler: resolves the auth instance per-request so that runtime
// config changes (e.g. publicUrl set via Tailscale wizard) take effect
// without a process restart.
export const GET = async (request: NextRequest) => {
  const auth = await getAuth();
  const handler = toNextJsHandler(auth);
  return handler.GET(request);
};

export const POST = async (request: NextRequest) => {
  const auth = await getAuth();
  const handler = toNextJsHandler(auth);
  return handler.POST(request);
};
