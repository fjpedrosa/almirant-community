import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { AcceptInvitationStatus } from "../../domain/types";

export const buildInvitationAuthRedirect = (invitationId: string): string => {
  const returnTo = `/accept-invitation/${invitationId}`;
  return `/signup?invitation=1&redirectTo=${encodeURIComponent(returnTo)}`;
};

export const useAcceptInvitation = (invitationId: string) => {
  const [asyncStatus, setAsyncStatus] = useState<
    "idle" | "accepting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();
  const session = authClient.useSession();

  const isAuthenticated = !!session.data?.user;
  const isSessionLoading = session.isPending;

  useEffect(() => {
    if (isSessionLoading || !isAuthenticated || asyncStatus !== "idle") return;

    const accept = async () => {
      setAsyncStatus("accepting");

      try {
        const result = await authClient.organization.acceptInvitation({
          invitationId,
        });

        if (result.error) {
          setAsyncStatus("error");
          setErrorMessage(
            result.error.message ?? "Failed to accept the invitation."
          );
          return;
        }

        setAsyncStatus("success");

        setTimeout(() => {
          router.push("/");
        }, 1500);
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : "An unexpected error occurred.";
        setAsyncStatus("error");
        setErrorMessage(reason);
      }
    };

    void accept();
  }, [invitationId, isAuthenticated, isSessionLoading, asyncStatus, router]);

  const status: AcceptInvitationStatus = useMemo(() => {
    if (isSessionLoading) return "loading";
    if (!isAuthenticated && asyncStatus === "idle") return "auth_required";
    if (asyncStatus === "accepting") return "accepting";
    if (asyncStatus === "success") return "success";
    if (asyncStatus === "error") return "error";
    return "loading";
  }, [isSessionLoading, isAuthenticated, asyncStatus]);

  const message = useMemo(() => {
    switch (status) {
      case "loading":
        return "Checking session...";
      case "auth_required":
        return "You need to sign in to accept this invitation.";
      case "accepting":
        return "Accepting invitation...";
      case "success":
        return "Invitation accepted! Redirecting...";
      case "error":
        return errorMessage ?? "An unexpected error occurred.";
    }
  }, [status, errorMessage]);

  const signIn = useCallback(() => {
    window.location.assign(buildInvitationAuthRedirect(invitationId));
  }, [invitationId]);

  return { status, message, signIn };
};
