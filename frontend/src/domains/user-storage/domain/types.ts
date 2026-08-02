import { z } from "zod";

export const MAX_USER_STORAGE_PATH_LENGTH = 512;
const MAX_USER_STORAGE_PATH_SEGMENT_LENGTH = 128;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const byteCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const userStorageVirtualPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_USER_STORAGE_PATH_LENGTH)
  .refine(
    (path) => {
      if (
        path.startsWith("/") ||
        path.includes("\\") ||
        CONTROL_CHARACTERS.test(path)
      ) {
        return false;
      }

      return path.split("/").every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".." &&
          segment.length <= MAX_USER_STORAGE_PATH_SEGMENT_LENGTH,
      );
    },
    "Storage path must be a relative POSIX path with valid segments",
  );

export const userStorageUsageSchema = z.object({
  quotaBytes: byteCountSchema,
  usedBytes: byteCountSchema,
  reservedBytes: byteCountSchema,
  quotaObjects: byteCountSchema,
  usedObjects: byteCountSchema,
  reservedObjects: byteCountSchema,
  availableObjects: byteCountSchema.optional(),
  updatedAt: z.string().datetime().optional(),
});

export const userStorageFileSchema = z.object({
  id: z.string().min(1),
  virtualPath: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: byteCountSchema,
  kind: z.enum(["file", "plugin_bundle"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const userStorageFileListSchema = z.array(userStorageFileSchema);

export const deleteUserStorageFileResultSchema = z.object({
  deleted: z.boolean(),
});

export type UserStorageUsage = z.infer<typeof userStorageUsageSchema>;
export type UserStorageFile = z.infer<typeof userStorageFileSchema>;
export type DeleteUserStorageFileResult = z.infer<
  typeof deleteUserStorageFileResultSchema
>;

export interface UploadUserStorageFileInput {
  file: File;
  path?: string;
}
