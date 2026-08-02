"use client";

import { useMemo, useState } from "react";
import { Braces, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { detectOutputFormat } from "@/domains/sessions/application/utils/detect-output-format";
import { JsonTreeBlock } from "./json-tree-block";

interface DataBlockProps {
  content: string;
  format: "json" | "text";
  byteLength: number;
  lineCount: number;
}

/**
 * How long a preview to keep in the DOM when expanded.
 *
 * A single transcript can carry several of these, and one job produced 25,000
 * events, so an expanded block must not put an unbounded string on the page.
 * The cut is explicit — the footer says how much is hidden and offers the rest —
 * because a silent truncation reads as "that's all there was".
 */
const PREVIEW_LIMIT = 4_000;

const formatBytes = (bytes: number): string =>
  bytes < 1_024
    ? `${bytes} B`
    : bytes < 1_024 * 1_024
      ? `${(bytes / 1_024).toFixed(1)} KB`
      : `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;

/**
 * A data dump, shown as data.
 *
 * Deliberately dumb: it never parses the content, so it cannot fail on the
 * malformed payloads that are common here — the 19,837-character block that
 * prompted this had another subagent's output spliced into the middle and is not
 * valid JSON. It only measures, previews, and gets out of the way.
 *
 * `whitespace-pre` with its own horizontal scroll is the whole point: wrapping
 * data breaks identifiers and URLs mid-word.
 */
export const DataBlock: React.FC<DataBlockProps> = ({
  content,
  format,
  byteLength,
  lineCount,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Parsing happens once, off the render path, and only after the reader opens
  // the block — never for the dozens of collapsed blocks a transcript holds.
  // `parsed` is absent whenever JSON.parse failed, which is how the raw view
  // stays the guaranteed fallback rather than an error state.
  const detected = useMemo(
    () => (isOpen ? detectOutputFormat(content) : undefined),
    [isOpen, content],
  );

  const isTruncated = !showAll && content.length > PREVIEW_LIMIT;
  const visible = isTruncated ? content.slice(0, PREVIEW_LIMIT) : content;
  const Icon = format === "json" ? Braces : FileText;
  const firstLine = content.trimStart().split("\n", 1)[0] ?? "";

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[0.9375rem] transition-colors hover:bg-muted/40"
      >
        {isOpen ? (
          <ChevronDown className="size-3.5 flex-shrink-0 text-foreground/50" />
        ) : (
          <ChevronRight className="size-3.5 flex-shrink-0 text-foreground/50" />
        )}
        <Icon className="size-4 flex-shrink-0 text-muted-foreground" />
        <span className="font-sans font-semibold whitespace-nowrap text-muted-foreground">
          {format === "json" ? "JSON" : "Datos"}
        </span>
        <span className="shrink-0 whitespace-nowrap font-mono text-sm text-muted-foreground/70">
          {formatBytes(byteLength)} · {lineCount.toLocaleString("es-ES")}{" "}
          {lineCount === 1 ? "línea" : "líneas"}
        </span>
        {!isOpen && (
          <code className="truncate font-mono text-sm text-foreground/50">
            {firstLine}
          </code>
        )}
      </button>
      {isOpen && (
        <div className="mt-1 ml-6">
          {detected?.parsed !== undefined ? (
            <JsonTreeBlock value={detected.parsed} />
          ) : (
            <pre className="max-h-80 max-w-full overflow-auto whitespace-pre rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-sm text-foreground/80">
              {visible}
            </pre>
          )}
          {isTruncated && detected?.parsed === undefined && (
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                mostrando {PREVIEW_LIMIT.toLocaleString("es-ES")} de{" "}
                {content.length.toLocaleString("es-ES")} caracteres
              </span>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                mostrar todo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
