"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useProgressiveJsonNode } from "../../../application/hooks/use-progressive-json-node";

interface JsonTreeBlockProps {
  value: unknown;
  /** Levels expanded on first render. Deeper nodes start collapsed. */
  defaultOpenDepth?: number;
  /** Keep the tree inside its own vertical scroller. Disable inside a parent scroller. */
  constrainHeight?: boolean;
  /** Number of children revealed per explicit page. */
  childrenPageSize?: number;
}

interface JsonNodeProps {
  name: string | null;
  value: unknown;
  depth: number;
  defaultOpenDepth: number;
  childrenPageSize: number;
}

/**
 * Children rendered before the rest is summarised.
 *
 * A catalogue array can hold 200 entries and each entry a dozen fields, so an
 * uncapped tree puts thousands of nodes on the page for a single event. The cap
 * is per node and states what it hid.
 */
const CHILDREN_LIMIT = 100;

const isExpandable = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const describe = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[] ${value.length} ${value.length === 1 ? "elemento" : "elementos"}`;
  }
  if (isExpandable(value)) {
    const keys = Object.keys(value);
    return `{} ${keys.length} ${keys.length === 1 ? "campo" : "campos"}`;
  }
  if (typeof value === "string") return `"${value}"`;
  return String(value);
};

const scalarClassName = (value: unknown): string => {
  if (typeof value === "string") return "text-emerald-600 dark:text-emerald-400";
  if (typeof value === "number") return "text-sky-600 dark:text-sky-400";
  if (typeof value === "boolean") return "text-violet-600 dark:text-violet-400";
  return "text-muted-foreground";
};

const JsonNode: React.FC<JsonNodeProps> = ({
  name,
  value,
  depth,
  defaultOpenDepth,
  childrenPageSize,
}) => {
  const expandable = isExpandable(value);
  const isArray = Array.isArray(value);
  const objectKeys =
    expandable && !isArray ? Object.keys(value) : [];
  const totalChildren = isArray ? value.length : objectKeys.length;
  const disclosure = useProgressiveJsonNode({
    defaultOpen: depth < defaultOpenDepth,
    totalChildren,
    pageSize: childrenPageSize,
  });

  if (!expandable) {
    return (
      <div className="flex gap-1.5 py-0.5 font-mono text-xs">
        {name !== null && <span className="text-foreground/60">{name}:</span>}
        <span className={scalarClassName(value)}>{describe(value)}</span>
      </div>
    );
  }

  const visible: ReadonlyArray<readonly [string, unknown]> = isArray
    ? value
        .slice(0, disclosure.visibleCount)
        .map((item, index) => [String(index), item] as const)
    : objectKeys
        .slice(0, disclosure.visibleCount)
        .map((key) => [key, value[key as keyof typeof value]] as const);

  return (
    <div className="font-mono text-xs">
      <button
        type="button"
        aria-expanded={disclosure.isOpen}
        onClick={disclosure.toggle}
        className="flex w-full items-center gap-1 py-0.5 text-left transition-colors hover:bg-muted/40"
      >
        {disclosure.isOpen ? (
          <ChevronDown className="size-3 flex-shrink-0 text-foreground/40" />
        ) : (
          <ChevronRight className="size-3 flex-shrink-0 text-foreground/40" />
        )}
        {name !== null && <span className="text-foreground/60">{name}:</span>}
        <span className="text-muted-foreground">{describe(value)}</span>
      </button>
      {disclosure.isOpen && (
        <div className="ml-3 border-l border-border/50 pl-2">
          {visible.map(([key, child]) => (
            <JsonNode
              key={key}
              name={key}
              value={child}
              depth={depth + 1}
              defaultOpenDepth={defaultOpenDepth}
              childrenPageSize={childrenPageSize}
            />
          ))}
          {disclosure.hiddenCount > 0 ? (
            <button
              type="button"
              onClick={disclosure.revealNextPage}
              className="py-1 text-left text-xs text-primary hover:underline"
            >
              Mostrar los siguientes{" "}
              {disclosure.nextPageCount.toLocaleString("es-ES")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};

/**
 * A parsed JSON value, as a tree.
 *
 * Only ever mounted with a value that `JSON.parse` already returned, so it does
 * no parsing and cannot fail on malformed input — the caller shows raw text in
 * that case.
 */
export const JsonTreeBlock: React.FC<JsonTreeBlockProps> = ({
  value,
  defaultOpenDepth = 2,
  constrainHeight = true,
  childrenPageSize = CHILDREN_LIMIT,
}) => (
  <div
    data-testid="json-tree-block"
    className={
      constrainHeight
        ? "max-h-80 overflow-auto rounded-md border border-border/60 bg-muted/40 px-2.5 py-2"
        : "min-w-0 max-w-full overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-2.5 py-2"
    }
  >
    <JsonNode
      name={null}
      value={value}
      depth={0}
      defaultOpenDepth={defaultOpenDepth}
      childrenPageSize={childrenPageSize}
    />
  </div>
);
