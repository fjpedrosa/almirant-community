"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// Web Speech API type declarations (not in all TS libs)
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onaudiostart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface UseSpeechToTextOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

interface UseSpeechToTextReturn {
  isListening: boolean;
  isReady: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
  error: string | null;
}

const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "language-not-supported"]);
const MAX_RETRIES = 5;
const RESTART_DELAY_MS = 300;

export const useSpeechToText = (
  onResult?: (text: string) => void,
  onInterim?: (text: string) => void,
  options: UseSpeechToTextOptions = {}
): UseSpeechToTextReturn => {
  const {
    lang = "es-ES",
    continuous = true,
    interimResults = true,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  const wantToListenRef = useRef(false);
  const retriesRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextRef = useRef("");
  const startSessionRef = useRef<() => void>(() => {});

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onInterimRef.current = onInterim;
  }, [onInterim]);

  const isSupported = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in (window as unknown as Record<string, unknown>));

  const flushPendingText = useCallback(() => {
    if (pendingTextRef.current) {
      onResultRef.current?.(pendingTextRef.current);
      pendingTextRef.current = "";
    }
  }, []);

  const stopListening = useCallback(() => {
    wantToListenRef.current = false;
    retriesRef.current = 0;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.onaudiostart = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    flushPendingText();
    setIsReady(false);
    setIsListening(false);
  }, [flushPendingText]);

  const startSession = useCallback(() => {
    if (!isSupported) return;

    const w = window as unknown as Record<string, unknown>;
    const SpeechRecognitionAPI = (w.SpeechRecognition || w.webkitSpeechRecognition) as { new(): SpeechRecognitionInstance };
    const recognition = new SpeechRecognitionAPI();

    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    recognition.onaudiostart = () => {
      setIsReady(true);
    };

    recognition.onresult = (event) => {
      const e = event as SpeechRecognitionEvent;
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (finalTranscript) {
        retriesRef.current = 0;
        pendingTextRef.current = "";
        setTranscript(finalTranscript);
        onResultRef.current?.(finalTranscript);
      } else if (interimTranscript) {
        pendingTextRef.current = interimTranscript;
        setTranscript(interimTranscript);
        onInterimRef.current?.(interimTranscript);
      }
    };

    recognition.onerror = (event) => {
      const err = (event as SpeechRecognitionErrorEvent).error;
      if (FATAL_ERRORS.has(err)) {
        setError(err === "not-allowed"
          ? "Permiso de micrófono denegado. Actívalo en los ajustes del navegador."
          : `Error: ${err}`);
        wantToListenRef.current = false;
      }
    };

    recognition.onend = () => {
      flushPendingText();

      recognitionRef.current = null;
      if (!wantToListenRef.current) {
        setIsListening(false);
        return;
      }

      retriesRef.current += 1;
      if (retriesRef.current > MAX_RETRIES) {
        setError("El reconocimiento de voz se detuvo tras varios intentos. Haz clic para reintentar.");
        wantToListenRef.current = false;
        setIsListening(false);
        return;
      }

      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (wantToListenRef.current) {
          startSessionRef.current();
        }
      }, RESTART_DELAY_MS);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      wantToListenRef.current = false;
      setError("No se pudo iniciar el reconocimiento de voz");
      setIsListening(false);
    }
  }, [isSupported, lang, continuous, interimResults, flushPendingText]);

  useEffect(() => {
    startSessionRef.current = startSession;
  }, [startSession]);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("Tu navegador no soporta reconocimiento de voz");
      return;
    }

    stopListening();

    setError(null);
    setTranscript("");
    setIsReady(false);
    wantToListenRef.current = true;
    retriesRef.current = 0;
    pendingTextRef.current = "";

    startSession();
    setIsListening(true);
  }, [isSupported, stopListening, startSession]);

  useEffect(() => {
    return () => {
      wantToListenRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }
      if (recognitionRef.current) {
        recognitionRef.current.onaudiostart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
      }
    };
  }, []);

  return {
    isListening,
    isReady,
    transcript,
    startListening,
    stopListening,
    isSupported,
    error,
  };
};
