import {
  deleteFromS3,
  downloadBufferFromS3,
  getEditorUploadsBucket,
  isS3Configured,
  uploadBufferToS3,
} from "../../../shared/services/s3-service";
import type { UserStorageObjectStorePort } from "./user-storage-service";

export class UserStorageUnavailableError extends Error {
  readonly code = "USER_STORAGE_UNAVAILABLE";

  constructor() {
    super("Private user storage is not configured");
    this.name = "UserStorageUnavailableError";
  }
}

export interface UserStorageS3Dependencies {
  getPrivateBucket: () => string | null;
  isConfigured: (bucket: string) => boolean;
  upload: (
    bytes: Uint8Array,
    key: string,
    contentType: string,
    bucket: string,
    options: { cacheControl?: string },
  ) => Promise<unknown>;
  download: (key: string, bucket: string) => Promise<Uint8Array>;
  remove: (key: string, bucket: string) => Promise<unknown>;
}

const defaultDependencies: UserStorageS3Dependencies = {
  getPrivateBucket: getEditorUploadsBucket,
  isConfigured: (bucket) => isS3Configured(bucket),
  upload: uploadBufferToS3,
  download: downloadBufferFromS3,
  remove: deleteFromS3,
};

export const createS3UserStorageObjectStore = (
  dependencies: UserStorageS3Dependencies = defaultDependencies,
): UserStorageObjectStorePort => {
  const getConfiguredBucket = (): string => {
    const bucket = dependencies.getPrivateBucket();
    if (!bucket || !dependencies.isConfigured(bucket)) {
      throw new UserStorageUnavailableError();
    }
    return bucket;
  };

  return {
    put: async ({ key, bytes, contentType }) =>
      await dependencies.upload(bytes, key, contentType, getConfiguredBucket(), {
        cacheControl: "private, no-store",
      }),
    get: async (key) => await dependencies.download(key, getConfiguredBucket()),
    delete: async (key) => await dependencies.remove(key, getConfiguredBucket()),
  };
};

export const userStorageObjectStore = createS3UserStorageObjectStore();
