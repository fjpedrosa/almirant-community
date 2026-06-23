"use client";

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Hook: useBootingMessages
// ---------------------------------------------------------------------------
// Rotates through booting message keys at a fixed interval.
// Extracted from SessionBootingState to keep the .tsx file presentational.
// ---------------------------------------------------------------------------

const BOOTING_MESSAGE_KEYS = [
  "booting.preparing",
  "booting.summoning",
  "booting.sharpening",
  "booting.reviewing",
  "booting.almostReady",
] as const;

export type BootingMessageKey = (typeof BOOTING_MESSAGE_KEYS)[number];

export const useBootingMessages = (intervalMs = 2500) => {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % BOOTING_MESSAGE_KEYS.length);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return {
    messageKey: BOOTING_MESSAGE_KEYS[messageIndex],
  };
};
