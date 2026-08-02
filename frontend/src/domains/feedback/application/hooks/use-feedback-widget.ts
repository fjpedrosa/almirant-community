"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackApi } from "@/lib/api/client";
import { feedbackKeys } from "./use-feedback-traceability";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { useIsMobile } from "@/lib/hooks";
import {
  captureScreenshot,
  collectDebugMetadata,
} from "../utils/collect-debug-context";
import type {
  FeedbackWidgetCategory,
  FeedbackWidgetSubmitPayload,
  FeedbackWidgetSimpleMetadata,
  DebugContext,
} from "../../domain/types";

export const useFeedbackWidget = () => {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackWidgetCategory>("other");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);

  // Ref to store pre-captured screenshot blob and any capture error
  const screenshotRef = useRef<Blob | null>(null);
  const captureErrorRef = useRef<string | null>(null);

  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Listen for "open-feedback" custom event from mobile sidebar
  useEffect(() => {
    const handler = () => {
      setIsOpen(true);
      setIsCapturingScreenshot(true);
      captureScreenshot().then((result) => {
        screenshotRef.current = result.blob;
        captureErrorRef.current = result.error;
        setIsCapturingScreenshot(false);
      });
    };
    window.addEventListener("open-feedback", handler);
    return () => window.removeEventListener("open-feedback", handler);
  }, []);

  const mutation = useMutation({
    mutationFn: (data: FeedbackWidgetSubmitPayload) =>
      feedbackApi.createItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.items() });
      setIsSuccess(true);
      setError(null);
      // Auto-close after success
      setTimeout(() => {
        setIsOpen(false);
        resetForm();
      }, 2000);
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to submit feedback");
    },
  });

  const resetForm = useCallback(() => {
    setCategory("other");
    setMessage("");
    setEmail("");
    setError(null);
    setIsSuccess(false);
    screenshotRef.current = null;
    captureErrorRef.current = null;
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        // Open dialog immediately, capture screenshot in background
        setIsOpen(true);
        setIsCapturingScreenshot(true);
        captureScreenshot().then((result) => {
          screenshotRef.current = result.blob;
          captureErrorRef.current = result.error;
          setIsCapturingScreenshot(false);
        });
      } else {
        setIsOpen(false);
        // Only reset success state when closing; preserve form data on error
        if (isSuccess) {
          resetForm();
        }
        setError(null);
        setIsSuccess(false);
        // Clear screenshot on close
        screenshotRef.current = null;
      }
    },
    [isSuccess, resetForm]
  );

  const handleSubmit = useCallback(async () => {
    if (!message.trim()) {
      setError("Message is required");
      return;
    }

    const title = message.trim().slice(0, 120);
    const pageUrl =
      typeof window !== "undefined" ? window.location.href : "";
    // Get locale from html lang attribute
    const locale =
      typeof document !== "undefined"
        ? document.documentElement.lang || "en"
        : "en";

    // Bifurcate by category: bug reports get full debug context
    if (category === "bug") {
      setIsCapturingScreenshot(true);

      let screenshotKey: string | null = null;
      let screenshotError: string | null = captureErrorRef.current;

      // Upload screenshot if available. Since A-1906 screenshots are stored
      // under a flat `feedback-screenshots/<uuid>-<name>` prefix and resolved
      // via `GET /api/feedback-items/:id/screenshot`, so the admin UI no
      // longer depends on the uploader's active organization.
      if (screenshotRef.current) {
        try {
          const file = new File(
            [screenshotRef.current],
            "feedback-screenshot.png",
            { type: "image/png" }
          );
          const result = await feedbackApi.uploadScreenshot(file);
          screenshotKey = result.key;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          screenshotError = `upload: ${msg}`;
          screenshotKey = null;
        }
      } else if (!screenshotError) {
        screenshotError = "blob was null at submit time (ref cleared?)";
      }

      setIsCapturingScreenshot(false);

      // Collect full debug metadata (async to support userAgentData API).
      // For new items `screenshotUrl` is null — viewers resolve the screenshot
      // via the feedback-item id, not a stored URL.
      const debugMetadata: DebugContext = await collectDebugMetadata(null);
      debugMetadata.screenshotKey = screenshotKey;
      // Temporarily include screenshot error in metadata for diagnostics
      if (screenshotError) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (debugMetadata as any).screenshotError = screenshotError;
      }

      const payload: FeedbackWidgetSubmitPayload = {
        category,
        title,
        content: message.trim(),
        status: "new",
        metadata: debugMetadata,
      };

      // Add author info if available
      if (user?.name) {
        payload.authorName = user.name;
      }
      if (user?.id) {
        payload.authorMeta = { userId: user.id };
      }
      if (email.trim()) {
        payload.authorEmail = email.trim();
      }

      mutation.mutate(payload);
    } else {
      // Non-bug feedback: simple metadata, unchanged flow
      const simpleMetadata: FeedbackWidgetSimpleMetadata = {
        pageUrl,
        locale,
        source: "widget",
      };

      const payload: FeedbackWidgetSubmitPayload = {
        category,
        title,
        content: message.trim(),
        status: "new",
        metadata: simpleMetadata,
      };

      if (email.trim()) {
        payload.authorEmail = email.trim();
      }

      mutation.mutate(payload);
    }
  }, [message, category, email, mutation, user]);

  return {
    isOpen,
    isMobile,
    category,
    message,
    email,
    isPending: mutation.isPending,
    isSuccess,
    isCapturingScreenshot,
    error,
    onOpenChange: handleOpenChange,
    onCategoryChange: setCategory,
    onMessageChange: setMessage,
    onEmailChange: setEmail,
    onSubmit: handleSubmit,
  };
};
