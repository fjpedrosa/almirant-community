"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { X, Pencil, Calendar as CalendarIcon } from "lucide-react";
import type { EditProjectFormData } from "../../application/hooks/use-edit-project-form";

export interface EditProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<EditProjectFormData>;
  onSubmit: (data: EditProjectFormData) => void;
  isPending: boolean;
  colorOptions: string[];
  workspaceOptions: { id: string; name: string }[];
  isLoadingWorkspaces: boolean;
  addTech: (tech: string) => void;
  removeTech: (tech: string) => void;
  transferConfirmation?: {
    projectName: string;
    fromWorkspaceName: string;
    toWorkspaceName: string;
  } | null;
  onConfirmTransfer?: () => void;
  onCancelTransfer?: () => void;
}

export const EditProjectDialog: React.FC<EditProjectDialogProps> = ({
  open,
  onOpenChange,
  form,
  onSubmit,
  isPending,
  colorOptions,
  workspaceOptions,
  isLoadingWorkspaces,
  addTech,
  removeTech,
  transferConfirmation,
  onConfirmTransfer,
  onCancelTransfer,
}) => {
  const [techInput, setTechInput] = useState("");
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");

  const handleTechKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && techInput.trim()) {
      e.preventDefault();
      addTech(techInput.trim());
      setTechInput("");
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    if (techInput.trim()) {
      addTech(techInput.trim());
      setTechInput("");
    }
    form.handleSubmit(onSubmit)(e);
  };

  const techStack = form.watch("techStack") || [];

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t("editProject")}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={handleFormSubmit} className="space-y-4">
            {/* Row 1: Name + Color + Status */}
            <div className="flex items-end gap-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>
                      {t("form.name")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("form.namePlaceholder")}
                        autoFocus
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="h-9 w-9 rounded-md border border-input flex-shrink-0 relative transition-colors hover:border-foreground/50"
                        style={{ backgroundColor: field.value }}
                        title={t("form.colorTitle")}
                      >
                        <Pencil className="h-3 w-3 absolute bottom-0.5 right-0.5 text-white drop-shadow-sm" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" align="end">
                      <div className="grid grid-cols-5 gap-1.5">
                        {colorOptions.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => field.onChange(color)}
                            className={cn(
                              "w-7 h-7 rounded-md border-2 transition-all hover:scale-110",
                              field.value === color
                                ? "border-foreground ring-1 ring-foreground/20"
                                : "border-transparent"
                            )}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem className="w-[130px] flex-shrink-0">
                    <FormLabel>{t("form.status")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">{t("status.active")}</SelectItem>
                        <SelectItem value="on_hold">{t("status.onHold")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>
            {form.formState.errors.name && (
              <p className="text-destructive text-sm -mt-2">
                {form.formState.errors.name.message}
              </p>
            )}

            {/* Row 2: Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.description")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder={t("form.descriptionPlaceholder")}
                      rows={2}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Row 3: Client + Tech Stack */}
            <FormField
              control={form.control}
              name="workspaceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.workspace")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger disabled={isLoadingWorkspaces}>
                        <SelectValue placeholder={t("form.workspacePlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {workspaceOptions.map((workspace) => (
                        <SelectItem key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            {/* Row 4: Client + Tech Stack */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="clientName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.client")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("form.clientPlaceholder")}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid gap-2">
                <Label>{t("form.techStack")}</Label>
                <Input
                  value={techInput}
                  onChange={(e) => setTechInput(e.target.value)}
                  onKeyDown={handleTechKeyDown}
                  placeholder={t("form.techStackPlaceholder")}
                />
              </div>
            </div>
            {techStack.length > 0 && (
              <div className="flex flex-wrap gap-1 -mt-2">
                {techStack.map((tech) => (
                  <Badge
                    key={tech}
                    variant="secondary"
                    className="text-xs gap-1"
                  >
                    {tech}
                    <button
                      type="button"
                      onClick={() => removeTech(tech)}
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Row 5: URLs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="productionUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.productionUrl")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="url"
                        placeholder="https://..."
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="stagingUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.stagingUrl")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="url"
                        placeholder="https://staging..."
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            {/* Row 6: Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.startDate")}</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {field.value
                              ? format(field.value, "dd/MM/yyyy")
                              : tCommon("selectDate")}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="targetDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.targetDate")}</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {field.value
                              ? format(field.value, "dd/MM/yyyy")
                              : tCommon("selectDate")}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isPending || !form.formState.isValid}
              >
                {isPending ? tCommon("saving") : tCommon("save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

    <AlertDialog
      open={!!transferConfirmation}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onCancelTransfer?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("transfer.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("transfer.description", {
              projectName: transferConfirmation?.projectName ?? "",
              fromWorkspace: transferConfirmation?.fromWorkspaceName ?? "",
              toWorkspace: transferConfirmation?.toWorkspaceName ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancelTransfer}>
            {t("transfer.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmTransfer}>
            {t("transfer.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};
