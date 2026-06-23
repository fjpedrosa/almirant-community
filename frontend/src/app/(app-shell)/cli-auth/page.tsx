"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type Status = "auth_required" | "loading" | "success" | "error";

type CreateKeyResponse = {
  success?: boolean;
  data?: { key?: string; id?: string };
  error?: string;
};

const buildCallbackUrl = (callback: string, params: Record<string, string>) => {
  const url = new URL(callback);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
};

export default function CliAuthPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("Checking session...");

  const session = authClient.useSession();
  const searchParams = useSearchParams();

  const callback = searchParams.get("callback");
  const keyName = searchParams.get("name") || "Almirant CLI";

  useEffect(() => {
    if (!callback) {
      setStatus("error");
      setMessage("Missing callback parameter.");
      return;
    }

    if (session.isPending) {
      setStatus("loading");
      setMessage("Checking session...");
      return;
    }

    if (!session.data?.user) {
      setStatus("auth_required");
      setMessage("You need to sign in to continue.");
      return;
    }

    const run = async () => {
      try {
        setStatus("loading");
        setMessage("Generating API key for CLI...");

        const response = await fetch("/api/api-keys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: keyName }),
        });

        const data = (await response.json()) as CreateKeyResponse;

        if (!response.ok || !data.success || !data.data?.key) {
          throw new Error(data.error || "Failed to generate API key");
        }

        setStatus("success");
        setMessage("Authentication complete. Redirecting back to CLI...");

        window.location.href = buildCallbackUrl(callback, {
          apiKey: data.data.key,
          keyId: data.data.id || "",
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        setStatus("error");
        setMessage(`Failed to generate API key: ${reason}`);
        window.location.href = buildCallbackUrl(callback, { error: reason });
      }
    };

    void run();
  }, [callback, keyName, session.data?.user, session.isPending]);

  const signIn = () => {
    if (!callback) return;

    const callbackURL = `/cli-auth?${new URLSearchParams({
      callback,
      name: keyName,
    }).toString()}`;

    authClient.signIn.social({
      provider: "google",
      callbackURL,
      errorCallbackURL: `/sign-in?error=unauthorized&redirectTo=${encodeURIComponent(callbackURL)}`,
    });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
      <div className="w-full rounded-lg border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Almirant CLI Auth</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        {status === "auth_required" && (
          <button
            type="button"
            onClick={signIn}
            className="mt-5 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Sign in with Google
          </button>
        )}
      </div>
    </div>
  );
}
