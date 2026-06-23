"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bug, CalendarIcon, Plus, Tags, User } from "lucide-react";
import { CopyPromptButton } from "./copy-prompt-button";
import { cn } from "@/lib/utils";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { MarkdownEditorField } from "./markdown-editor-field";
import { PriorityStarRating } from "./priority-star-rating";
import { StatusBadgeSelector } from "./status-badge-selector";
import { ProjectBadgeSelector } from "./project-badge-selector";
import { TagMultiSelector } from "./tag-multi-selector";
import { ParentSelector } from "./parent-selector";
import { UserMultiSelect } from "@/domains/teams/presentation/components/user-multi-select";
import type { UseFormReturn } from "react-hook-form";
import type { WorkItemFormData, WorkItemType } from "../../domain/types";
import { isParentType } from "../../domain/types";
import type { BoardColumn } from "@/domains/boards/domain/types";
import type { SelectableUser } from "@/domains/teams/domain/types";

const FIBONACCI_VALUES = [
  { value: "none" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "8", label: "8" },
];

interface WorkItemFormContentProps {
  form: UseFormReturn<WorkItemFormData>;
  onSubmit: () => void;
  isPending: boolean;
  submitLabel: string;
  cancelLabel?: string;
  onCancel: () => void;
  // Available options
  availableParents: { id: string; title: string; type: WorkItemType }[];
  availableProjects: { id: string; name: string }[];
  isLoadingParents?: boolean;
  // User
  currentUserName?: string;
  onAssignToMe?: () => void;
  // Parent creation
  showParentField?: boolean;
  onCreateParent?: () => void;
  // Form validity
  isFormValid?: boolean;
  // AI formatting
  onAiFormatDescription?: () => void;
  isAiFormattingDescription?: boolean;
  onAiFormatDefinitionOfDone?: () => void;
  isAiFormattingDefinitionOfDone?: boolean;
  // Copy as prompt
  onCopyPrompt?: () => void;
  isCopyingPrompt?: boolean;
  showCopySuccess?: boolean;
  // Tags
  availableTags?: { id: string; name: string; color: string }[];
  isLoadingTags?: boolean;
  onCreateTag?: (name: string, color: string) => Promise<string>;
  // Board columns (status selector)
  boardColumns?: BoardColumn[];
  currentColumnId?: string | null;
  onChangeColumn?: (columnId: string) => void;
  // Read-only mode (when AI is processing)
  readOnly?: boolean;
  // Assignee multi-select (team mode)
  availableAssignees?: SelectableUser[];
  hasActiveTeam?: boolean;
  selectedAssigneeIds?: string[];
  onSelectAssignee?: (userId: string) => void;
  onRemoveAssignee?: (userId: string) => void;
  // Image upload
  onImageUpload?: (file: File) => Promise<string>;
  // Children (attachments, pending files)
  children?: React.ReactNode;
}

export const WorkItemFormContent: React.FC<WorkItemFormContentProps> = ({
  form,
  onSubmit,
  isPending,
  submitLabel,
  cancelLabel,
  onCancel,
  availableParents,
  availableProjects,
  isLoadingParents,
  currentUserName,
  onAssignToMe,
  showParentField = true,
  onCreateParent,
  isFormValid = true,
  onAiFormatDescription,
  isAiFormattingDescription,
  onAiFormatDefinitionOfDone,
  isAiFormattingDefinitionOfDone,
  onCopyPrompt,
  isCopyingPrompt,
  showCopySuccess,
  availableTags,
  isLoadingTags,
  onCreateTag,
  boardColumns,
  currentColumnId,
  onChangeColumn,
  readOnly = false,
  availableAssignees,
  hasActiveTeam = false,
  selectedAssigneeIds,
  onSelectAssignee,
  onRemoveAssignee,
  onImageUpload,
  children,
}) => {
  const t = useTranslations("workItems");
  const tCommon = useTranslations("common");
  const tEstimation = useTranslations("estimation");
  const { formatLong, locale } = useFormattedDate();

  const currentType = form.watch("type");
  const isParentDisabled =
    isLoadingParents ||
    availableParents.length === 0 ||
    currentType === "epic";

  // For parent form, hide parent field if type is epic
  const shouldShowParentField = showParentField && currentType !== "epic";

  const FIBONACCI_OPTIONS = FIBONACCI_VALUES.map((opt) => ({
    value: opt.value,
    label: opt.value === "none" ? tEstimation("unestimated") : opt.label!,
  }));

  // Whether to render the multi-select assignee component
  const useMultiSelectAssignee =
    hasActiveTeam &&
    !!availableAssignees &&
    !!onSelectAssignee &&
    !!onRemoveAssignee;

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        <div className={cn("max-h-[70vh] overflow-y-auto space-y-4 pr-2", readOnly && "pointer-events-none opacity-60")}>

          {/* Estado | Prioridad | Proyecto - aligned grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            {boardColumns && boardColumns.length > 0 && currentColumnId && onChangeColumn && !isParentType(currentType) ? (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">{t("form.status")}</FormLabel>
                <StatusBadgeSelector
                  columns={boardColumns}
                  currentColumnId={currentColumnId}
                  onChangeColumn={onChangeColumn}
                />
              </FormItem>
            ) : (
              <div />
            )}

            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs">{t("form.priority")}</FormLabel>
                  <PriorityStarRating
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="projectId"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs">{t("form.project")}</FormLabel>
                  <ProjectBadgeSelector
                    projects={availableProjects}
                    currentProjectId={field.value}
                    onChangeProject={field.onChange}
                  />
                </FormItem>
              )}
            />
          </div>

          {/* Description - MDEditor */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("form.description")}</FormLabel>
                <FormControl>
                  <MarkdownEditorField
                    value={field.value}
                    onChange={field.onChange}
                    height={200}
                    onAiFormat={onAiFormatDescription}
                    isAiFormatting={isAiFormattingDescription}
                    onImageUpload={onImageUpload}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Definition of Done - MDEditor */}
          <FormField
            control={form.control}
            name="definitionOfDone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("form.definitionOfDone")}</FormLabel>
                <FormControl>
                  <MarkdownEditorField
                    value={field.value}
                    onChange={field.onChange}
                    height={150}
                    onAiFormat={onAiFormatDefinitionOfDone}
                    isAiFormatting={isAiFormattingDefinitionOfDone}
                    onImageUpload={onImageUpload}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Assignee + "Yo" button | Due Date - 2 cols */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {useMultiSelectAssignee ? (
              <FormItem>
                <FormLabel>{t("form.assignee")}</FormLabel>
                <div className="flex gap-1">
                  <div className="flex-1">
                    <UserMultiSelect
                      availableUsers={availableAssignees}
                      selectedUserIds={selectedAssigneeIds ?? []}
                      onSelect={onSelectAssignee}
                      onRemove={onRemoveAssignee}
                    />
                  </div>
                  {currentUserName && onAssignToMe && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={onAssignToMe}
                      title={t("form.assignToMe")}
                    >
                      <User className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </FormItem>
            ) : (
              <FormField
                control={form.control}
                name="assignee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.assignee")}</FormLabel>
                    <div className="flex gap-1">
                      <FormControl>
                        <Input {...field} placeholder={t("form.assigneePlaceholder")} className="flex-1" />
                      </FormControl>
                      {currentUserName && onAssignToMe && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={onAssignToMe}
                          title={t("form.assignToMe")}
                        >
                          <User className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.dueDate")}</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {field.value
                            ? formatLong(field.value)
                            : tCommon("selectDate")}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        initialFocus
                        locale={locale}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Estimated Hours | Parent | Tags button - 2 cols + tag trigger */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="estimatedHours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.estimatedHours")}</FormLabel>
                  <Select
                    value={field.value != null ? String(field.value) : "none"}
                    onValueChange={(v) =>
                      field.onChange(v === "none" ? undefined : parseFloat(v))
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={tEstimation("unestimated")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {FIBONACCI_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {shouldShowParentField && (
              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.parent")}</FormLabel>
                    <div className="flex gap-1">
                      <div className="flex-1">
                        <ParentSelector
                          value={field.value}
                          onChange={field.onChange}
                          parents={availableParents}
                          isLoading={!!isLoadingParents}
                          disabled={isParentDisabled}
                        />
                      </div>
                      {onCreateParent && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={onCreateParent}
                          title={t("form.createParent")}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Placeholder when parent field is hidden to keep layout */}
            {!shouldShowParentField && showParentField && (
              <div className="text-sm text-muted-foreground flex items-end pb-2">
                {t("form.epicsNoParent")}
              </div>
            )}
          </div>

          {/* Tags section */}
          {availableTags && (
            <FormField
              control={form.control}
              name="tagIds"
              render={({ field }) => (
                <FormItem>
                  <TagMultiSelector
                    value={field.value}
                    onChange={field.onChange}
                    tags={availableTags}
                    isLoading={isLoadingTags}
                    onCreateTag={onCreateTag}
                    trigger={
                      <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                        <Tags className="h-3.5 w-3.5" />
                        Tags
                        {field.value.length > 0 && (
                          <span className="bg-primary/10 text-primary text-[10px] rounded-full px-1.5 py-0.5 font-medium">
                            {field.value.length}
                          </span>
                        )}
                      </Button>
                    }
                  />
                </FormItem>
              )}
            />
          )}

          {/* Bug flag - only for tasks */}
          {currentType === "task" && (
            <FormField
              control={form.control}
              name="isBug"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Switch
                      checked={field.value ?? false}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel className="!mt-0 flex items-center gap-1.5 text-sm cursor-pointer">
                    <Bug className="h-4 w-4 text-red-500" />
                    {t("form.bug")}
                  </FormLabel>
                </FormItem>
              )}
            />
          )}

          {/* Attachments, Pending files (injected via children) */}
          {children}
        </div>

        {!readOnly && (
          <div className="flex items-center pt-2 border-t">
            {onCopyPrompt && (
              <CopyPromptButton
                onCopy={onCopyPrompt}
                isCopying={isCopyingPrompt ?? false}
                showSuccess={showCopySuccess}
              />
            )}
            <div className="flex justify-end gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={onCancel}>
                {cancelLabel ?? tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isPending || !isFormValid}>
                {submitLabel}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Form>
  );
};
