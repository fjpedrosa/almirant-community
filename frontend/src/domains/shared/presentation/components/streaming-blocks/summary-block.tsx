import { CheckCircle2 } from "lucide-react";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";

interface SummaryBlockProps {
  text: string;
  section: "Summary" | "Resumen";
}

export const SummaryBlock: React.FC<SummaryBlockProps> = ({ text, section }) => (
  <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
    <p className="text-xs font-medium text-primary/70 uppercase tracking-wide mb-2 flex items-center gap-1.5">
      <CheckCircle2 className="size-3.5" />
      {section}
    </p>
    <div className="min-w-0 max-w-full overflow-x-auto text-base text-foreground">
      <MarkdownPreview content={text} size="base" className="min-w-0 max-w-full" />
    </div>
  </div>
);
