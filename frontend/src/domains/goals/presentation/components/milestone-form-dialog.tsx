"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { MilestoneFormDialogProps } from "../../domain/types";

export const MilestoneFormDialog: React.FC<MilestoneFormDialogProps> = ({
  isOpen,
  mode,
  form,
  isPending,
  isLoadingWorkItems,
  availableWorkItems,
  onOpenChange,
  onSubmit,
}) => {
  const t = useTranslations("goals");
  const tCommon = useTranslations("common");

  const title = mode === "create" ? t("form.newMilestone") : t("form.editMilestone");
  const description =
    mode === "create"
      ? t("form.newDescription")
      : t("form.editDescription");

  const sortedWorkItems = [...availableWorkItems].sort((a, b) => {
    const aLabel = `${a.taskId ?? ""} ${a.title}`.trim();
    const bLabel = `${b.taskId ?? ""} ${b.title}`.trim();
    return aLabel.localeCompare(bLabel);
  });

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
            className="space-y-4 overflow-y-auto min-h-0 flex-1"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t("form.title")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("form.titlePlaceholder")} />
                    </FormControl>
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
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.priority")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("form.selectPriority")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t("form.description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        placeholder={t("form.descriptionPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="workItemIds"
                render={({ field }) => {
                  const selected = field.value ?? [];

                  return (
                    <FormItem className="md:col-span-2 space-y-2">
                      <FormLabel>{t("form.linkedWorkItems")}</FormLabel>

                      {isLoadingWorkItems ? (
                        <div className="space-y-2 rounded-md border p-3">
                          <Skeleton className="h-5 w-full" />
                          <Skeleton className="h-5 w-full" />
                          <Skeleton className="h-5 w-full" />
                        </div>
                      ) : (
                        <ScrollArea className="h-52 rounded-md border p-3">
                          <div className="space-y-2 pr-3">
                            {sortedWorkItems.length === 0 && (
                              <p className="text-sm text-muted-foreground">
                                {t("form.noWorkItems")}
                              </p>
                            )}

                            {sortedWorkItems.map((item) => {
                              const checked = selected.includes(item.id);

                              return (
                                <label
                                  key={item.id}
                                  className="flex items-start gap-3 rounded-md border p-2 cursor-pointer hover:bg-muted/40"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(nextChecked: boolean | "indeterminate") => {
                                      if (nextChecked === true) {
                                        field.onChange(
                                          Array.from(new Set([...selected, item.id]))
                                        );
                                        return;
                                      }

                                      field.onChange(
                                        selected.filter((id) => id !== item.id)
                                      );
                                    }}
                                  />

                                  <span className="min-w-0 text-sm">
                                    <span className="block truncate font-medium">
                                      {item.taskId ? `${item.taskId} - ` : ""}
                                      {item.title}
                                    </span>
                                    <span className="text-xs text-muted-foreground capitalize">
                                      {item.type} • {item.priority}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      )}
                    </FormItem>
                  );
                }}
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
              <Button type="submit" disabled={isPending || !form.formState.isValid}>
                {isPending ? t("form.saving") : mode === "create" ? t("form.createButton") : t("form.saveButton")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
