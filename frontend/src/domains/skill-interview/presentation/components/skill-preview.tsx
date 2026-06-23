import { ArrowLeft, Check, Copy, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import type { SkillPreviewProps } from "../../domain/types";

export const SkillPreview: React.FC<SkillPreviewProps> = ({
  skill,
  onBackToChat,
  onCopySkill,
  onDownloadSkill,
  hasCopiedSkill,
}) => {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FileText className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {skill.frontmatter.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {skill.frontmatter.description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void onCopySkill()}>
            {hasCopiedSkill ? (
              <Check className="mr-2 size-4" />
            ) : (
              <Copy className="mr-2 size-4" />
            )}
            {hasCopiedSkill ? "Copied" : "Copy raw file"}
          </Button>
          <Button type="button" variant="outline" onClick={onDownloadSkill}>
            <Download className="mr-2 size-4" />
            Download SKILL.md
          </Button>
          <Button type="button" variant="outline" onClick={onBackToChat}>
            <ArrowLeft className="mr-2 size-4" />
            Back to chat
          </Button>
        </div>
      </div>

      <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="overflow-auto border-b border-border p-6 lg:border-b-0 lg:border-r">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Raw SKILL.md
          </p>
          <div className="rounded-2xl border border-border bg-slate-950 p-5 text-sm text-slate-100">
            <pre className="whitespace-pre-wrap break-words font-mono">
              {skill.rawContent}
            </pre>
          </div>
        </div>

        <div className="overflow-auto p-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Rendered preview
          </p>
          <div className="mb-5 rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Argument Hint
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">
              {skill.frontmatter.argumentHint}
            </p>
          </div>
          <MarkdownPreview content={skill.body} size="sm" />
        </div>
      </div>
    </section>
  );
};
