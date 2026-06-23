"use client";

import { ImageLightbox } from "@/components/ui/image-lightbox";

interface LightboxImageProps {
  src?: string;
  alt?: string;
}

export const LightboxImage: React.FC<LightboxImageProps> = ({ src, alt }) => {
  if (!src) return null;

  return (
    <ImageLightbox
      src={src}
      alt={alt}
      className="w-full h-auto rounded-md my-2"
    />
  );
};
