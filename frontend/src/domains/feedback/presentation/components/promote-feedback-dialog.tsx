import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpRight, Loader2 } from "lucide-react";
import type { PromoteFeedbackDialogProps } from "../../domain/types";
import type { UseFormReturn } from "react-hook-form";
import { AiSuggestionsSection } from "./ai-suggestions-section";

interface PromoteFeedbackDialogInternalProps extends Omit<PromoteFeedbackDialogProps, "onSubmit"> {
  form: UseFormReturn<{
    workItemType: "task" | "story" | "feature" | "epic";
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    notes?: string;
  }>;
  onSubmit: () => void;
  isFormValid: boolean;
  reasoningOpen: boolean;
  onReasoningToggle: () => void;
}

export const PromoteFeedbackDialog: React.FC<PromoteFeedbackDialogInternalProps> = ({
  open,
  onOpenChange,
  feedbackItem,
  form,
  onSubmit,
  isPending,
  isFormValid,
  reasoningOpen,
  onReasoningToggle,
}) => {
  const { register, setValue, watch } = form;
  const workItemType = watch("workItemType");
  const priority = watch("priority");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-blue-500" />
            Promote to Work Item
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground mb-4">
          Creating a work item from feedback: <span className="font-medium text-foreground">{feedbackItem.title}</span>
        </div>

        <AiSuggestionsSection
          aiSuggestedType={feedbackItem.aiSuggestedType}
          aiSuggestedTitle={feedbackItem.aiSuggestedTitle}
          aiSuggestedSummary={feedbackItem.aiSuggestedSummary}
          aiCategory={feedbackItem.aiCategory}
          aiConfidence={feedbackItem.aiConfidence}
          aiReasoning={feedbackItem.aiReasoning}
          reasoningOpen={reasoningOpen}
          onReasoningToggle={onReasoningToggle}
        />

        <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="workItemType">Type</Label>
              <Select
                value={workItemType}
                onValueChange={(v) => setValue("workItemType", v as "task" | "story" | "feature" | "epic")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">Task</SelectItem>
                  <SelectItem value="story">Story</SelectItem>
                  <SelectItem value="feature">Feature</SelectItem>
                  <SelectItem value="epic">Epic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={priority ?? "medium"}
                onValueChange={(v) => setValue("priority", v as "low" | "medium" | "high" | "urgent")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              {...register("title")}
              placeholder="Work item title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              {...register("description")}
              placeholder="Work item description"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Promotion Notes</Label>
            <Textarea
              id="notes"
              {...register("notes")}
              placeholder="Why is this feedback being promoted? (optional)"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !isFormValid}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Promoting...
                </>
              ) : (
                <>
                  <ArrowUpRight className="mr-2 h-4 w-4" />
                  Promote
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
