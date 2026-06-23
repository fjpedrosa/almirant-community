"use client";

import { use } from "react";
import { AcceptInvitationContainer } from "@/domains/auth/presentation/containers/accept-invitation-container";

export default function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <AcceptInvitationContainer invitationId={id} />
    </div>
  );
}
