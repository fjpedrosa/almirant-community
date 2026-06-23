import { useMemo, createElement } from "react";
import { API_BASE } from "@/lib/api/client";

/**
 * Some doc sources store file paths prefixed with "docs/" (GitHub sync),
 * while assets are stored in S3 without that prefix (doc-assets/{projectId}/...).
 * Normalize to keep asset resolution stable.
 */
const normalizeDocFilePath = (filePath: string): string => {
  const withoutLeadingSlashes = filePath.replace(/^\/+/, "");
  if (withoutLeadingSlashes.startsWith("docs/")) {
    return withoutLeadingSlashes.slice("docs/".length);
  }
  return withoutLeadingSlashes;
};

/**
 * Resolve a relative image path against the document's file path.
 *
 * Notes:
 * - Absolute URLs / data URIs are handled elsewhere.
 * - Paths like "/assets/foo.svg" are treated as project-root relative.
 * - Paths starting with "assets/" are treated as project-root relative (common docs convention).
 */
const resolveRelativePath = (basePath: string, relativeSrc: string): string => {
  const src = relativeSrc.replace(/^\/+/, "");
  if (src.startsWith("assets/")) return src;

  // Get directory of the document file
  const baseDir = basePath.includes("/")
    ? basePath.substring(0, basePath.lastIndexOf("/"))
    : "";

  const segments = baseDir ? baseDir.split("/") : [];
  const relParts = src.split("/");

  for (const part of relParts) {
    if (part === "..") {
      segments.pop();
    } else if (part !== "." && part !== "") {
      segments.push(part);
    }
  }

  return segments.join("/");
};

/**
 * Hook that returns ReactMarkdown components with a custom `img` renderer
 * that resolves relative image paths to the document-assets API endpoint.
 */
export const useDocumentImageResolver = (
  filePath: string | null | undefined,
  projectId: string | null | undefined
) => {
  const components = useMemo(() => {
    if (!filePath || !projectId) return undefined;

    const normalizedFilePath = normalizeDocFilePath(filePath);

    return {
      img: (props: Record<string, unknown>) => {
        const { src, alt, ...rest } = props;
        const srcStr = typeof src === "string" ? src : "";
        const altStr = typeof alt === "string" ? alt : "";

        // Absolute URLs or data URIs — render as-is
        if (
          srcStr.startsWith("http://") ||
          srcStr.startsWith("https://") ||
          srcStr.startsWith("data:")
        ) {
          return createElement("img", { src: srcStr, alt: altStr, ...rest });
        }

        // Relative path — resolve against document's filePath
        const resolved = resolveRelativePath(normalizedFilePath, srcStr);
        const assetUrl = `${API_BASE}/document-assets/${projectId}/${resolved}`;

        return createElement("img", { src: assetUrl, alt: altStr, ...rest });
      },
    };
  }, [filePath, projectId]);

  return { components };
};
