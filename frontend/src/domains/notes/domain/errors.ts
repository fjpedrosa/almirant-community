import { ApiError } from "@/lib/api/client";

export type NoteErrorCode =
  | "NOTE_NOT_FOUND"
  | "NOTE_VERSION_CONFLICT"
  | "INVALID_CONTENT"
  | "INVALID_DATE"
  | "INVALID_MONTH"
  | "LEGACY_REPLAY_CONFLICT"
  | "LEGACY_SNAPSHOT_TOO_LARGE"
  | "NOTES_INTERNAL_ERROR";

export type NoteClientError = Error & { code: NoteErrorCode; status: number };

export const noteErrorCode = (error: unknown): NoteErrorCode => {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code as NoteErrorCode;
  }
  if (error instanceof ApiError && error.body && typeof error.body === "object" && "code" in error.body) {
    const code = (error.body as { code?: unknown }).code;
    if (typeof code === "string") return code as NoteErrorCode;
  }
  return "NOTES_INTERNAL_ERROR";
};

export const isNoteVersionConflict = (error: unknown): boolean =>
  noteErrorCode(error) === "NOTE_VERSION_CONFLICT";
