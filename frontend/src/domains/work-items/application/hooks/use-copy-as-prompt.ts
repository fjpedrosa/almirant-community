"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useAiFormatText } from "./use-ai-format-text";
import { workItemKeys } from "./use-work-items";
import { workItemsApi } from "@/lib/api/client";
import { useWsAi } from "@/domains/shared/application/hooks/use-ws-ai";

interface CopyAsPromptData {
  id?: string;
  title: string;
  description: string;
  definitionOfDone: string;
}

export const useCopyAsPrompt = () => {
  const aiFormat = useAiFormatText();
  const wsAi = useWsAi();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const markSuccess = useCallback((itemId: string) => {
    setSuccessId(itemId);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSuccessId(null), 2000);
  }, []);

  const copyAsPrompt = useCallback(
    async (data: CopyAsPromptData) => {
      const itemId = data.id ?? "__dialog__";
      setActiveId(itemId);

      const rawText = [
        `Titulo: ${data.title}`,
        data.description ? `Descripcion: ${data.description}` : null,
        data.definitionOfDone
          ? `Definition of Done: ${data.definitionOfDone}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      // Try WebSocket first (non-blocking, immediate feedback)
      console.info("[WS AI] copyAsPrompt called, isAvailable:", wsAi.isAvailable);
      if (wsAi.isAvailable) {
        const requestId = wsAi.requestAiFormat({
          text: rawText,
          fieldContext: "prompt",
          workItemId: data.id,
          onResult: async (result) => {
            try {
              await navigator.clipboard.writeText(result.formattedText);
              showToast.success("Prompt copiado al portapapeles");

              // If WS saved to DB, invalidate cache (also handled by work-item:updated handler)
              if (result.savedToDb) {
                queryClient.invalidateQueries({ queryKey: workItemKeys.all });
              }

              markSuccess(itemId);
            } catch {
              showToast.error("Error al copiar al portapapeles");
            } finally {
              setActiveId(null);
            }
          },
          onError: (error) => {
            showToast.error(error.message || "Error al generar el prompt con IA");
            setActiveId(null);
          },
        });

        if (requestId) {
          console.info("[WS AI] Request sent via WS, requestId:", requestId);
          return;
        }
        console.warn("[WS AI] requestAiFormat returned null, falling back to REST");
        // If requestAiFormat returned null (WS disconnected mid-call), fall through to REST
      }

      // Fallback: REST path
      console.info("[WS AI] Using REST fallback for format-text");
      try {
        const result = await aiFormat.mutateAsync({
          text: rawText,
          fieldContext: "prompt",
        });

        await navigator.clipboard.writeText(result.formattedText);
        showToast.success("Prompt copiado al portapapeles");

        // Save prompt to DB if work item has an ID (not create mode)
        if (data.id) {
          workItemsApi.savePrompt(data.id, result.formattedText)
            .then(() => queryClient.invalidateQueries({ queryKey: workItemKeys.all }))
            .catch(() => { /* silent - clipboard copy already succeeded */ });
        }

        markSuccess(itemId);
      } catch {
        showToast.error("Error al generar el prompt con IA");
      } finally {
        setActiveId(null);
      }
    },
    [aiFormat, wsAi, queryClient, markSuccess]
  );

  const copyMultipleAsPrompt = useCallback(
    async (items: CopyAsPromptData[]) => {
      setActiveId("__multi__");

      const rawText = items
        .map(
          (item, i) =>
            [
              `## Task ${i + 1}: ${item.title}`,
              item.description ? `Descripcion: ${item.description}` : null,
              item.definitionOfDone
                ? `Definition of Done: ${item.definitionOfDone}`
                : null,
            ]
              .filter(Boolean)
              .join("\n\n")
        )
        .join("\n\n---\n\n");

      // Try WebSocket first
      if (wsAi.isAvailable) {
        const requestId = wsAi.requestAiFormat({
          text: rawText,
          fieldContext: "multiPrompt",
          onResult: async (result) => {
            try {
              await navigator.clipboard.writeText(result.formattedText);
              showToast.success(`Prompt combinado copiado (${items.length} tareas)`);
              markSuccess("__multi__");
            } catch {
              showToast.error("Error al copiar al portapapeles");
            } finally {
              setActiveId(null);
            }
          },
          onError: (error) => {
            showToast.error(error.message || "Error al generar prompt combinado");
            setActiveId(null);
          },
        });

        if (requestId) return;
      }

      // Fallback: REST path
      try {
        const result = await aiFormat.mutateAsync({
          text: rawText,
          fieldContext: "multiPrompt",
        });

        await navigator.clipboard.writeText(result.formattedText);
        showToast.success(`Prompt combinado copiado (${items.length} tareas)`);

        markSuccess("__multi__");
      } catch {
        showToast.error("Error al generar prompt combinado");
      } finally {
        setActiveId(null);
      }
    },
    [aiFormat, wsAi, markSuccess]
  );

  return { copyAsPrompt, copyMultipleAsPrompt, activeId, successId };
};
