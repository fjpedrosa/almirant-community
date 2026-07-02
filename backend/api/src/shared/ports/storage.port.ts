/**
 * Storage port — shared interface for file upload/download across domains.
 *
 * Domain modules depend on this port instead of directly importing S3
 * or local-attachment implementations, enabling storage-agnostic code
 * and simpler testing with in-memory or mock stores.
 */

export interface StoragePort {
  upload(buffer: Uint8Array, key: string, contentType: string): Promise<string>;
  download(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  isConfigured(): boolean;
}

export interface AttachmentStoragePort {
  write(
    workspaceId: string,
    fileName: string,
    buffer: Uint8Array
  ): Promise<string>;
  resolve(path: string): string;
  delete(path: string): Promise<void>;
}
