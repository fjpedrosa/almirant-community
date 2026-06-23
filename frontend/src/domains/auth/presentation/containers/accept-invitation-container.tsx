"use client";

import { Suspense } from "react";
import { useAcceptInvitation } from "../../application/hooks/use-accept-invitation";
import { AcceptInvitationCard } from "../components/accept-invitation-card";

const AcceptInvitationContent = ({
  invitationId,
}: {
  invitationId: string;
}) => {
  const { status, message, signIn } = useAcceptInvitation(invitationId);

  return (
    <AcceptInvitationCard status={status} message={message} onSignIn={signIn} />
  );
};

export const AcceptInvitationContainer = ({
  invitationId,
}: {
  invitationId: string;
}) => {
  return (
    <Suspense>
      <AcceptInvitationContent invitationId={invitationId} />
    </Suspense>
  );
};
