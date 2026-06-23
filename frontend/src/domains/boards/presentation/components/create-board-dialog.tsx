"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, LayoutTemplate, PenLine, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CreateBoardDialogProps,
  BoardArea,
  BoardTemplate,
} from "../../domain/types";

type Step = "choose" | "template" | "scratch";

const AREA_KEYS: { value: BoardArea; key: string }[] = [
  { value: "desarrollo", key: "development" },
  { value: "ventas", key: "sales" },
  { value: "prospeccion", key: "prospecting" },
  { value: "marketing", key: "marketing" },
  { value: "general", key: "general" },
];

const areaColors: Record<string, string> = {
  desarrollo: "bg-indigo-100 text-indigo-800",
  ventas: "bg-green-100 text-green-800",
  prospeccion: "bg-amber-100 text-amber-800",
  marketing: "bg-pink-100 text-pink-800",
  general: "bg-cyan-100 text-cyan-800",
};

const TemplateCard: React.FC<{
  template: BoardTemplate;
  selected: boolean;
  onClick: () => void;
}> = ({ template, selected, onClick }) => (
  <Card
    className={`cursor-pointer transition-all hover:shadow-md ${
      selected ? "ring-2 ring-primary" : ""
    }`}
    onClick={onClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    }}
  >
    <CardContent className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{template.name}</p>
          {template.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {template.description}
            </p>
          )}
        </div>
        <Badge
          variant="secondary"
          className={`shrink-0 text-[10px] ${areaColors[template.area] ?? ""}`}
        >
          {template.area}
        </Badge>
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Columns3 className="h-3 w-3" />
        {template.columns.length} columns
      </div>
    </CardContent>
  </Card>
);

export const CreateBoardDialog: React.FC<CreateBoardDialogProps> = ({
  open,
  onOpenChange,
  templates,
  onCreateFromScratch,
  onCreateFromTemplate,
  isLoading,
}) => {
  const [step, setStep] = useState<Step>("choose");
  const t = useTranslations("boards");
  const tCommon = useTranslations("common");

  // Template flow state
  const [selectedTemplate, setSelectedTemplate] = useState<BoardTemplate | null>(null);
  const [templateBoardName, setTemplateBoardName] = useState("");

  // Scratch flow state
  const [scratchName, setScratchName] = useState("");
  const [scratchDescription, setScratchDescription] = useState("");
  const [scratchArea, setScratchArea] = useState<BoardArea>("general");
  const [scratchIsDefault, setScratchIsDefault] = useState(false);

  const resetState = () => {
    setStep("choose");
    setSelectedTemplate(null);
    setTemplateBoardName("");
    setScratchName("");
    setScratchDescription("");
    setScratchArea("general");
    setScratchIsDefault(false);
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) resetState();
    onOpenChange(value);
  };

  const handleCreateFromTemplate = () => {
    if (!selectedTemplate) return;
    onCreateFromTemplate({
      templateId: selectedTemplate.id,
      name: templateBoardName.trim() || undefined,
    });
  };

  const handleCreateFromScratch = () => {
    if (!scratchName.trim()) return;
    onCreateFromScratch({
      name: scratchName.trim(),
      description: scratchDescription.trim() || undefined,
      area: scratchArea,
      isDefault: scratchIsDefault,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step !== "choose" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  setStep("choose");
                  setSelectedTemplate(null);
                }}
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <DialogTitle>
                {step === "choose" && t("create.title")}
                {step === "template" && t("create.templateTitle")}
                {step === "scratch" && t("create.scratchTitle")}
              </DialogTitle>
              <DialogDescription>
                {step === "choose" && t("create.chooseDesc")}
                {step === "template" && t("create.templateDesc")}
                {step === "scratch" && t("create.scratchDesc")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === "choose" && (
          <div className="grid grid-cols-2 gap-3">
            <Card
              className="cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
              onClick={() => setStep("template")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setStep("template");
                }
              }}
            >
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <LayoutTemplate className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{t("create.fromTemplate")}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("create.fromTemplateDesc")}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
              onClick={() => setStep("scratch")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setStep("scratch");
                }
              }}
            >
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                  <PenLine className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{t("create.fromScratch")}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("create.fromScratchDesc")}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === "template" && (
          <div className="space-y-4">
            <div className="grid gap-2 max-h-64 overflow-y-auto pr-1">
              {templates.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t("create.noTemplates")}
                  </p>
                </div>
              ) : (
                templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    selected={selectedTemplate?.id === template.id}
                    onClick={() => setSelectedTemplate(template)}
                  />
                ))
              )}
            </div>

            {selectedTemplate && (
              <div className="space-y-1.5">
                <Label htmlFor="template-board-name" className="text-xs">
                  {t("create.boardNameOptional")}
                </Label>
                <Input
                  id="template-board-name"
                  value={templateBoardName}
                  onChange={(e) => setTemplateBoardName(e.target.value)}
                  placeholder={selectedTemplate.name}
                  className="h-8 text-sm"
                />
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isLoading}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={handleCreateFromTemplate}
                disabled={!selectedTemplate || isLoading}
              >
                {isLoading ? tCommon("creating") : t("createBoard")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "scratch" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="scratch-name">{t("form.name")}</Label>
              <Input
                id="scratch-name"
                value={scratchName}
                onChange={(e) => setScratchName(e.target.value)}
                placeholder={t("form.namePlaceholder")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="scratch-description">{t("form.description")}</Label>
              <Textarea
                id="scratch-description"
                value={scratchDescription}
                onChange={(e) => setScratchDescription(e.target.value)}
                placeholder={t("form.descriptionOptional")}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="scratch-area">{t("form.area")}</Label>
              <Select
                value={scratchArea}
                onValueChange={(v) => setScratchArea(v as BoardArea)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("form.selectArea")} />
                </SelectTrigger>
                <SelectContent>
                  {AREA_KEYS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(`areas.${option.key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="scratch-default" className="text-sm font-medium">
                  {t("form.defaultBoard")}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("form.setDefaultDesc")}
                </p>
              </div>
              <Switch
                id="scratch-default"
                checked={scratchIsDefault}
                onCheckedChange={(checked) =>
                  setScratchIsDefault(checked === true)
                }
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isLoading}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={handleCreateFromScratch}
                disabled={!scratchName.trim() || isLoading}
              >
                {isLoading ? tCommon("creating") : t("createBoard")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
