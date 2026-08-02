import { z } from "zod";
import {
  API_BASE,
  ApiError,
  buildApiRequestUrl,
  getSessionToken,
  request,
} from "@/lib/api/client";
import {
  deleteUserStorageFileResultSchema,
  userStorageFileListSchema,
  userStorageFileSchema,
  userStorageUsageSchema,
  userStorageVirtualPathSchema,
  type DeleteUserStorageFileResult,
  type UploadUserStorageFileInput,
  type UserStorageFile,
  type UserStorageUsage,
} from "../../domain/types";

const apiEnvelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

const redirectUnauthorized = () => {
  if (typeof window !== "undefined") {
    window.location.href = "/sign-in";
  }
};

const parseJsonEnvelope = async (
  response: Response,
  fallbackMessage: string,
): Promise<unknown> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      `Server error (${response.status})`,
      response.status,
      null,
    );
  }

  const envelope = apiEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    throw new ApiError(fallbackMessage, response.status, body);
  }

  if (response.status === 401) {
    redirectUnauthorized();
    throw new ApiError("Unauthorized", 401, body);
  }

  if (!response.ok || !envelope.data.success) {
    throw new ApiError(
      envelope.data.error ?? fallbackMessage,
      response.status,
      body,
    );
  }

  return envelope.data.data;
};

const authenticatedHeaders = (): HeadersInit => {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const encodedFileEndpoint = (id: string) =>
  `/storage/files/${encodeURIComponent(id)}`;

export const userStorageApi = {
  getUsage: async (): Promise<UserStorageUsage> =>
    userStorageUsageSchema.parse(await request<unknown>("/storage/usage")),

  listFiles: async (): Promise<UserStorageFile[]> =>
    userStorageFileListSchema.parse(await request<unknown>("/storage/files")),

  upload: async (
    input: UploadUserStorageFileInput,
  ): Promise<UserStorageFile> => {
    const formData = new FormData();
    formData.append("file", input.file);
    const path = input.path?.trim();
    if (path) formData.append("path", userStorageVirtualPathSchema.parse(path));

    const response = await fetch(
      buildApiRequestUrl(API_BASE, "/storage/files"),
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: authenticatedHeaders(),
        body: formData,
      },
    );

    return userStorageFileSchema.parse(
      await parseJsonEnvelope(response, "File upload failed"),
    );
  },

  download: async (id: string): Promise<Blob> => {
    const response = await fetch(
      buildApiRequestUrl(API_BASE, encodedFileEndpoint(id)),
      {
        cache: "no-store",
        credentials: "include",
        headers: authenticatedHeaders(),
      },
    );

    if (response.status === 401) {
      redirectUnauthorized();
      throw new ApiError("Unauthorized", 401, null);
    }

    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Binary endpoints are not required to return a JSON error envelope.
      }
      const parsed = apiEnvelopeSchema.safeParse(body);
      throw new ApiError(
        parsed.success
          ? (parsed.data.error ?? "File download failed")
          : "File download failed",
        response.status,
        body,
      );
    }

    return response.blob();
  },

  delete: async (id: string): Promise<DeleteUserStorageFileResult> =>
    deleteUserStorageFileResultSchema.parse(
      await request<unknown>(encodedFileEndpoint(id), { method: "DELETE" }),
    ),
};
