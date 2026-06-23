"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tailnetDatabaseApi } from "@/lib/api/client";
import type {
  TailnetDatabaseAuthMethod,
  TailnetDatabaseConnectInput,
  TailnetDatabaseStatusView,
} from "../../domain/types";

export const tailnetDatabaseKeys = {
  all: ["tailnet-database"] as const,
  status: () => [...tailnetDatabaseKeys.all, "status"] as const,
};

export const useTailnetDatabaseAccess = () => {
  const queryClient = useQueryClient();
  const [authMethod, setAuthMethod] = useState<TailnetDatabaseAuthMethod>("auth_key");
  const [hostname, setHostname] = useState("almirant-db");
  const [tag, setTag] = useState("tag:almirant-db");
  const [authKey, setAuthKey] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [hasDraftOverride, setHasDraftOverride] = useState(false);

  const statusQuery = useQuery<TailnetDatabaseStatusView>({
    queryKey: tailnetDatabaseKeys.status(),
    queryFn: () => tailnetDatabaseApi.getStatus(),
    refetchInterval: (query) =>
      query.state.data?.status === "provisioning" ? 5_000 : false,
  });

  const status = statusQuery.data ?? null;
  const effectiveAuthMethod = hasDraftOverride || !status?.authMethod
    ? authMethod
    : status.authMethod;
  const effectiveHostname = hasDraftOverride || !status
    ? hostname
    : status.hostname || "almirant-db";
  const effectiveTag = hasDraftOverride || !status
    ? tag
    : status.tag || "tag:almirant-db";

  const loadDraftFromStatus = (currentStatus: TailnetDatabaseStatusView) => {
    setAuthMethod(currentStatus.authMethod ?? "auth_key");
    setHostname(currentStatus.hostname || "almirant-db");
    setTag(currentStatus.tag || "tag:almirant-db");
    setHasDraftOverride(true);
  };

  const updateAuthMethod = (method: TailnetDatabaseAuthMethod) => {
    setHasDraftOverride(true);
    setAuthMethod(method);
  };

  const updateHostname = (nextHostname: string) => {
    setHasDraftOverride(true);
    setHostname(nextHostname);
  };

  const updateTag = (nextTag: string) => {
    setHasDraftOverride(true);
    setTag(nextTag);
  };

  const connectMutation = useMutation({
    mutationFn: () => {
      const payload: TailnetDatabaseConnectInput = {
        authMethod: effectiveAuthMethod,
        hostname: effectiveHostname,
        tag: effectiveTag,
      };
      if (effectiveAuthMethod === "auth_key") {
        payload.authKey = authKey;
      } else {
        payload.oauthClientId = oauthClientId;
        payload.oauthClientSecret = oauthClientSecret;
      }
      return tailnetDatabaseApi.connect(payload);
    },
    onSuccess: () => {
      setAuthKey("");
      setOauthClientSecret("");
      setIsEditing(false);
      setHasDraftOverride(false);
      queryClient.invalidateQueries({ queryKey: tailnetDatabaseKeys.all });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => tailnetDatabaseApi.test(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tailnetDatabaseKeys.all });
    },
  });

  const disableMutation = useMutation({
    mutationFn: () => tailnetDatabaseApi.disable(),
    onSuccess: () => {
      setAuthKey("");
      setOauthClientSecret("");
      setIsEditing(false);
      setHasDraftOverride(false);
      queryClient.invalidateQueries({ queryKey: tailnetDatabaseKeys.all });
    },
  });

  const handleEdit = () => {
    if (status) loadDraftFromStatus(status);
    else setHasDraftOverride(true);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setAuthKey("");
    setOauthClientSecret("");
    setHasDraftOverride(false);
    setIsEditing(false);
  };

  return {
    status,
    isLoading: statusQuery.isLoading,
    isEditing,
    authMethod: effectiveAuthMethod,
    setAuthMethod: updateAuthMethod,
    hostname: effectiveHostname,
    setHostname: updateHostname,
    tag: effectiveTag,
    setTag: updateTag,
    authKey,
    setAuthKey,
    oauthClientId,
    setOauthClientId,
    oauthClientSecret,
    setOauthClientSecret,
    isConnecting: connectMutation.isPending,
    isTesting: testMutation.isPending,
    isDisabling: disableMutation.isPending,
    handleEdit,
    handleCancelEdit,
    handleConnect: () => connectMutation.mutate(),
    handleTest: () => testMutation.mutate(),
    handleDisable: () => disableMutation.mutate(),
  };
};
