const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

const safeDownloadName = (fileName: string): string => {
  const basename = fileName.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const sanitized = basename.replace(CONTROL_CHARACTERS, "").trim();
  return sanitized && sanitized !== "." && sanitized !== ".."
    ? sanitized
    : "download";
};

export const saveDownloadedFile = (blob: Blob, fileName: string): void => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = safeDownloadName(fileName);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
};
