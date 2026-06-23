"use client";

import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { aiApi } from "@/lib/api/client";
import { useWsAi } from "./use-ws-ai";
import { useAiProviderPreference } from "@/domains/integrations/application/hooks/use-ai-provider-preference";
import type { AiFieldContext } from "../../domain/ws-types";

export interface AiFormatInput {
  text: string;
  fieldContext: AiFieldContext;
}

export interface AiFormatResult {
  formattedText: string;
}

export const useAiFormatText = () => {
  const wsAi = useWsAi();
  const { selectedKeyId } = useAiProviderPreference();
  const [wsIsPending, setWsIsPending] = useState(false);
  const [wsVariables, setWsVariables] = useState<AiFormatInput | null>(null);

  const restMutation = useMutation({
    mutationFn: (data: AiFormatInput) =>
      aiApi.formatText({
        ...data,
        providerKeyId: selectedKeyId || undefined,
      }),
    onError: () => {
      showToast.error("Error al formatear texto con IA");
    },
  });

  const mutate = useCallback(
    (data: AiFormatInput, options?: { onSuccess?: (data: AiFormatResult) => void }) => {
      if (wsAi.isAvailable) {
        setWsIsPending(true);
        setWsVariables(data);

        const requestId = wsAi.requestAiFormat({
          text: data.text,
          fieldContext: data.fieldContext,
          onResult: (result) => {
            setWsIsPending(false);
            setWsVariables(null);
            options?.onSuccess?.({ formattedText: result.formattedText });
          },
          onError: (error) => {
            setWsIsPending(false);
            setWsVariables(null);
            showToast.error(error.message || "Error al formatear texto con IA");
          },
        });

        if (requestId) return;

        setWsIsPending(false);
        setWsVariables(null);
      }

      restMutation.mutate(data, { onSuccess: options?.onSuccess });
    },
    [wsAi, restMutation]
  );

  const mutateAsync = useCallback(
    async (data: AiFormatInput): Promise<AiFormatResult> => {
      if (wsAi.isAvailable) {
        return new Promise<AiFormatResult>((resolve, reject) => {
          setWsIsPending(true);
          setWsVariables(data);

          const requestId = wsAi.requestAiFormat({
            text: data.text,
            fieldContext: data.fieldContext,
            onResult: (result) => {
              setWsIsPending(false);
              setWsVariables(null);
              resolve({ formattedText: result.formattedText });
            },
            onError: (error) => {
              setWsIsPending(false);
              setWsVariables(null);
              reject(new Error(error.message || "AI processing failed"));
            },
          });

          if (!requestId) {
            setWsIsPending(false);
            setWsVariables(null);
            resolve(restMutation.mutateAsync(data));
          }
        });
      }

      return restMutation.mutateAsync(data);
    },
    [wsAi, restMutation]
  );

  return {
    mutate,
    mutateAsync,
    isPending: wsIsPending || restMutation.isPending,
    variables: wsVariables || restMutation.variables,
  };
};
