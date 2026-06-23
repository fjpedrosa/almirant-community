import { resolveAuthEntryPath } from "@/domains/auth/application/lib/auth-route-state";
import { getAuthBootstrapStatus } from "@/lib/auth-bootstrap";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const DEFAULT_AUTHENTICATED_LANDING = "/board";

export default async function RootPage() {
  const reqHeaders = await headers();
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: reqHeaders,
  });

  if (session) {
    redirect(DEFAULT_AUTHENTICATED_LANDING);
  }

  const bootstrapStatus = await getAuthBootstrapStatus();
  redirect(resolveAuthEntryPath(bootstrapStatus));
}
