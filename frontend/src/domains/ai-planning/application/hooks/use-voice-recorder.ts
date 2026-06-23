"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { aiApi } from "@/lib/api/client";
import type {
  VoiceRecorderState,
  UseVoiceRecorderReturn,
} from "@/domains/ai-planning/domain/types";

const MAX_RECORDING_DURATION_MS = 300000; // 5 minutes

export const useVoiceRecorder = (
  onTranscript: (text: string) => void,
): UseVoiceRecorderReturn => {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const isSupported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof MediaRecorder !== "undefined";

  const cleanup = useCallback(() => {
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore errors when stopping already stopped recorder
      }
    }
    mediaRecorderRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setMediaStream(null);

    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError("Voice recording is not supported in this browser");
      return;
    }

    setError(null);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setMediaStream(stream);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = () => {
        setError("Recording error occurred");
        cleanup();
        setState("idle");
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        cleanup();

        setState("transcribing");

        try {
          const result = await aiApi.transcribeAudio(audioBlob);
          if (result?.text) {
            onTranscript(result.text);
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Transcription failed";
          setError(message);
        }

        setState("idle");
      };

      mediaRecorder.start(100);
      setState("recording");

      maxDurationTimeoutRef.current = setTimeout(() => {
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state === "recording"
        ) {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORDING_DURATION_MS);
    } catch (err) {
      cleanup();
      setState("idle");

      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setError("Microphone permission denied. Please allow microphone access.");
        } else if (err.name === "NotFoundError") {
          setError("No microphone found. Please connect a microphone and try again.");
        } else {
          setError(`Microphone error: ${err.message}`);
        }
      } else {
        const message =
          err instanceof Error ? err.message : "Failed to start recording";
        setError(message);
      }
    }
  }, [isSupported, cleanup, onTranscript]);

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return {
    state,
    isRecording: state === "recording",
    isTranscribing: state === "transcribing",
    isSupported,
    error,
    startRecording,
    stopRecording,
    mediaStream,
  };
};
