declare module "sharp" {
  export type SharpPngOptions = {
    compressionLevel?: number;
    palette?: boolean;
    quality?: number;
  };

  export type SharpJpegOptions = {
    quality?: number;
    mozjpeg?: boolean;
  };

  export interface SharpInstance {
    png(options?: SharpPngOptions): SharpInstance;
    jpeg(options?: SharpJpegOptions): SharpInstance;
    toBuffer(): Promise<Buffer>;
  }

  const sharp: (input: Buffer | Uint8Array | ArrayBuffer) => SharpInstance;

  export default sharp;
}
