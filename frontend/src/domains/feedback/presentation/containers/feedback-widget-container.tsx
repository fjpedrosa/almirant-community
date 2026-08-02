"use client";

import { useEffect } from "react";
import { useFeedbackWidget } from "../../application/hooks/use-feedback-widget";
import { FeedbackWidget } from "../components/feedback-widget";
import {
  initConsoleErrorCapture,
  destroyConsoleErrorCapture,
} from "../../application/utils/console-error-buffer";

export function FeedbackWidgetContainer() {
  // Initialize console error capture on mount, clean up on unmount
  useEffect(() => {
    initConsoleErrorCapture();
    return () => {
      destroyConsoleErrorCapture();
    };
  }, []);

  const widgetState = useFeedbackWidget();

  return <FeedbackWidget {...widgetState} />;
}
