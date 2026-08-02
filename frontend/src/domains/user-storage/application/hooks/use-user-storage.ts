"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userStorageApi } from "../../infrastructure/api/user-storage-api";
import type {
  UploadUserStorageFileInput,
  UserStorageFile,
  UserStorageUsage,
} from "../../domain/types";

export const userStorageKeys = {
  all: ["user-storage"] as const,
  usage: () => [...userStorageKeys.all, "usage"] as const,
  files: () => [...userStorageKeys.all, "files"] as const,
};

export const useUserStorageUsage = () =>
  useQuery<UserStorageUsage>({
    queryKey: userStorageKeys.usage(),
    queryFn: userStorageApi.getUsage,
  });

export const useUserStorageFiles = () =>
  useQuery<UserStorageFile[]>({
    queryKey: userStorageKeys.files(),
    queryFn: userStorageApi.listFiles,
  });

const useInvalidateUserStorage = () => {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: userStorageKeys.all });
};

export const useUploadUserStorageFile = () => {
  const invalidateUserStorage = useInvalidateUserStorage();
  return useMutation({
    mutationFn: (input: UploadUserStorageFileInput) =>
      userStorageApi.upload(input),
    onSuccess: invalidateUserStorage,
  });
};

export const useDeleteUserStorageFile = () => {
  const invalidateUserStorage = useInvalidateUserStorage();
  return useMutation({
    mutationFn: (id: string) => userStorageApi.delete(id),
    onSuccess: invalidateUserStorage,
  });
};

export const useDownloadUserStorageFile = () =>
  useMutation({
    mutationFn: (id: string) => userStorageApi.download(id),
  });
