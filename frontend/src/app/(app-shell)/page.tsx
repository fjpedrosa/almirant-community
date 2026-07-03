import { resolveAuthEntryPath } from "@/domains/auth/application/lib/auth-route-state";
import { getAuthBootstrapStatus } from "@/lib/auth-bootstrap";
import { getServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const DEFAULT_AUTHENTICATED_LANDING = "/board";

export default async function RootPage() {
  const session = await getServerSession();

  if (session) {
    redirect(DEFAULT_AUTHENTICATED_LANDING);
  }

  const bootstrapStatus = await getAuthBootstrapStatus();
  redirect(resolveAuthEntryPath(bootstrapStatus));
}
