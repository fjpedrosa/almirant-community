"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useRef, useCallback } from "react";
import { FileText, ExternalLink, User, Tag, Calendar, Building2, Pencil, Trash2, Check, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { cn } from "@/lib/utils";
import type { ExpenseDetailPanelProps, ExpenseStatus, InvoiceProcessingStatus, ExpenseWithRelations, ExpenseCategory } from "../../domain/types";
import type { TeamMemberUser } from "@/domains/teams/domain/types";
import { useUpdateExpense, useExpenseCategories } from "../../application/hooks/use-expenses";
import { useTeamMembersSelect } from "@/domains/teams/application/hooks/use-team-members-select";
import { useQueryClient } from "@tanstack/react-query";

// --- Utility Functions ---

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateStr: string, locale: string): string {
    return new Date(dateStr).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function formatDateTime(dateStr: string, locale: string): string {
    return new Date(dateStr).toLocaleString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function formatAmount(amount: string, currency: string, locale: string): string {
    const num = parseFloat(amount)
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
    }).format(num)
}

// --- Status Badge ---

function StatusBadge({ status, label }: { status: ExpenseStatus; label: string }) {
    const classNames: Record<ExpenseStatus, string> = {
        draft: "bg-gray-100 text-gray-700 border-gray-200",
        pending_approval: "bg-amber-100 text-amber-700 border-amber-200",
        approved: "bg-blue-100 text-blue-700 border-blue-200",
        rejected: "bg-red-100 text-red-700 border-red-200",
        paid: "bg-green-100 text-green-700 border-green-200",
        void: "bg-gray-100 text-gray-500 border-gray-200",
    }
    return (
        <Badge variant="outline" className={cn(classNames[status], "border")}>
            {label}
        </Badge>
    )
}

// --- Invoice Processing Badge ---

function InvoiceProcessingBadge({ processingStatus, label }: { processingStatus: InvoiceProcessingStatus; label: string }) {
    const classNames: Record<InvoiceProcessingStatus, string> = {
        pending: "bg-gray-100 text-gray-600",
        processing: "bg-blue-100 text-blue-700",
        processed: "bg-green-100 text-green-700",
        failed: "bg-red-100 text-red-700",
    }
    return (
        <Badge variant="secondary" className={cn(classNames[processingStatus])}>
            {label}
        </Badge>
    )
}

// --- Skeleton ---

function DetailPanelSkeleton() {
    return (
        <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-5 w-1/4" />
            <Separator />
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Separator />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
        </div>
    )
}

// --- Inline Title ---

interface InlineTitleProps {
    value: string
    onChange: (value: string) => void
    isLoading?: boolean
    savingField?: string | null
}

function InlineTitle({ value, onChange, isLoading, savingField }: InlineTitleProps) {
    const [draft, setDraft] = useState(value)
    const [isEditing, setIsEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const t = useTranslations("expenses")

    const startEdit = () => {
        if (savingField === "title") return
        setIsEditing(true)
        setDraft(value)
        setTimeout(() => inputRef.current?.focus(), 0)
    }

    const cancelEdit = () => {
        setIsEditing(false)
        setDraft(value)
    }

    const saveEdit = () => {
        const trimmed = draft.trim()
        if (!trimmed) return
        onChange(trimmed)
        setIsEditing(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            saveEdit()
        }
    }

    return (
        <div className="group min-w-0 flex-1">
            {isEditing ? (
                <div className="flex items-center gap-2 w-full">
                    <Input
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="text-lg font-semibold h-9"
                    />
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            className="h-6 w-6 text-muted-foreground"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={saveEdit}
                            disabled={isLoading}
                        >
                            <Check className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-between gap-1">
                    <h1 className="text-lg font-semibold flex-1">{value}</h1>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={startEdit}
                        className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100"
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    )
}

// --- Inline Description ---

interface InlineDescriptionProps {
    value: string | null
    onChange: (description: string | null) => void
    isLoading?: boolean
    savingField?: string | null
}

function InlineDescription({ value, onChange, isLoading, savingField }: InlineDescriptionProps) {
    const [draft, setDraft] = useState(value || "")
    const [isEditing, setIsEditing] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const t = useTranslations("expenses")

    const adjustHeight = useCallback(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
        }
    }, [])

    const startEdit = () => {
        if (savingField === "description") return
        setIsEditing(true)
        setDraft(value || "")
        setTimeout(() => {
            textareaRef.current?.focus()
            adjustHeight()
        }, 0)
    }

    const cancelEdit = () => {
        setIsEditing(false)
        setDraft(value || "")
    }

    const saveEdit = () => {
        const trimmed = draft.trim()
        onChange(trimmed || null)
        setIsEditing(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault()
            saveEdit()
        }
    }

    return (
        <div className="group min-w-0 flex-1">
            {isEditing ? (
                <div className="space-y-2">
                    <Textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={(e) => {
                            setDraft(e.target.value)
                            adjustHeight()
                        }}
                        onKeyDown={handleKeyDown}
                        rows={3}
                        className="min-h-[80px] resize-y"
                    />
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={cancelEdit}>
                            {t("detail.cancel")}
                        </Button>
                        <Button size="sm" onClick={saveEdit} disabled={isLoading}>
                            {t("detail.save")}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {t("detail.saveHint")}
                    </p>
                </div>
            ) : (
                <button
                    type="button"
                    className="group/desc relative w-full rounded-md border border-dashed px-3 py-2 text-left transition-colors hover:bg-muted/40"
                    onClick={startEdit}
                >
                    {value ? (
                        <MarkdownPreview content={value} size="sm" />
                    ) : (
                        <p className="text-sm text-muted-foreground italic">
                            {t("detail.writeDescription")}
                        </p>
                    )}
                    <Pencil className="absolute right-2 top-2 h-3.5 w-3.5 text-muted-foreground touch-visible" />
                </button>
            )}
        </div>
    )
}

// --- Inline Metadata Field Wrapper ---

interface InlineMetadataFieldProps {
    label: string
    icon: React.ReactNode
    children: React.ReactNode
}

function InlineMetadataField({ label, icon, children }: InlineMetadataFieldProps) {
    return (
        <div className="flex items-center gap-2 py-1.5">
            {icon}
            <span className="font-medium text-foreground min-w-[100px]">{label}</span>
            <div className="flex-1">{children}</div>
        </div>
    )
}

// --- Inline Date Field ---

interface InlineDateFieldProps {
    value: string
    onChange: (date: string) => void
    isLoading?: boolean
    savingField?: string | null
}

function InlineDateField({ value, onChange, isLoading, savingField }: InlineDateFieldProps) {
    const [draft, setDraft] = useState(value)
    const [isEditing, setIsEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const t = useTranslations("expenses")
    const locale = useLocale()
    const intlLocale = locale.startsWith("es") ? "es-ES" : "en-US"

    const startEdit = () => {
        if (savingField === "expenseDate") return
        setIsEditing(true)
        setDraft(value)
        setTimeout(() => inputRef.current?.focus(), 0)
    }

    const cancelEdit = () => {
        setIsEditing(false)
        setDraft(value)
    }

    const saveEdit = () => {
        const trimmed = draft.trim()
        if (!trimmed) return
        onChange(trimmed)
        setIsEditing(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault()
            saveEdit()
        }
    }

    return (
        <div className="group min-w-0 flex-1">
            {isEditing ? (
                <div className="flex items-center gap-2">
                    <Input
                        ref={inputRef}
                        type="date"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="h-8 w-full"
                    />
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            className="h-6 w-6 text-muted-foreground"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={saveEdit}
                            disabled={isLoading}
                        >
                            <Check className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-between gap-1">
                    <span className="text-sm">{formatDate(value, intlLocale)}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={startEdit}
                        className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100"
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    )
}

// --- Inline Vendor Field ---

interface InlineVendorFieldProps {
    value: string | null
    onChange: (vendor: string | null) => void
    isLoading?: boolean
    savingField?: string | null
}

function InlineVendorField({ value, onChange, isLoading, savingField }: InlineVendorFieldProps) {
    const [draft, setDraft] = useState(value || "")
    const [isEditing, setIsEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const t = useTranslations("expenses")

    const startEdit = () => {
        if (savingField === "vendor") return
        setIsEditing(true)
        setDraft(value || "")
        setTimeout(() => inputRef.current?.focus(), 0)
    }

    const cancelEdit = () => {
        setIsEditing(false)
        setDraft(value || "")
    }

    const saveEdit = () => {
        const trimmed = draft.trim()
        onChange(trimmed || null)
        setIsEditing(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault()
            saveEdit()
        }
    }

    return (
        <div className="group min-w-0 flex-1">
            {isEditing ? (
                <div className="flex items-center gap-2 w-full">
                    <Input
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t("detail.vendorPlaceholder")}
                        className="h-8 w-full"
                    />
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            className="h-6 w-6 text-muted-foreground"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={saveEdit}
                            disabled={isLoading}
                        >
                            <Check className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-between gap-1">
                    {value ? (
                        <span className="text-sm truncate">{value}</span>
                    ) : (
                        <button
                            type="button"
                            onClick={startEdit}
                            className="text-sm text-muted-foreground italic hover:text-foreground"
                        >
                            {t("detail.addVendor")}
                        </button>
                    )}
                    {value && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={startEdit}
                            className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}

// --- Inline Category Field ---

interface InlineCategoryFieldProps {
    value: ExpenseCategory | null
    onChange: (categoryId: string | null) => void
    isLoading?: boolean
    savingField?: string | null
    categories: ExpenseCategory[]
}

function InlineCategoryField({ value, onChange, isLoading, savingField, categories }: InlineCategoryFieldProps) {
    const [isEditing, setIsEditing] = useState(false)
    const t = useTranslations("expenses")

    const startEdit = () => {
        if (savingField === "categoryId") return
        setIsEditing(true)
    }

    const handleSelect = (categoryId: string) => {
        onChange(categoryId)
        setIsEditing(false)
    }

    return (
        <div className="group min-w-0 flex-1">
            {isEditing ? (
                <Popover open={isEditing} onOpenChange={setIsEditing}>
                    <PopoverTrigger asChild>
                        <button type="button" className="w-full text-left">
                            {value ? (
                                <Badge
                                    variant="secondary"
                                    style={value.color ? { backgroundColor: `${value.color}20`, color: value.color } : undefined}
                                >
                                    {value.icon && <span className="mr-1">{value.icon}</span>}
                                    {value.name}
                                </Badge>
                            ) : (
                                <span className="text-sm text-muted-foreground italic">
                                    {t("detail.selectCategory")}
                                </span>
                            )}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-0" align="start">
                        <Command>
                            <CommandInput placeholder={t("detail.searchCategory")} />
                            <CommandList>
                                <CommandEmpty>{t("detail.noCategoriesFound")}</CommandEmpty>
                                <CommandGroup>
                                    <CommandItem onSelect={() => handleSelect("")}>
                                        <span className="text-muted-foreground">{t("detail.noCategory")}</span>
                                    </CommandItem>
                                    {categories.map((cat) => (
                                        <CommandItem
                                            key={cat.id}
                                            value={cat.id}
                                            onSelect={() => handleSelect(cat.id)}
                                        >
                                            <div className="flex items-center gap-2">
                                                {cat.icon && <span>{cat.icon}</span>}
                                                <span>{cat.name}</span>
                                                {cat.color && (
                                                    <span
                                                        className="size-2 rounded-full"
                                                        style={{ backgroundColor: cat.color }}
                                                    />
                                                )}
                                            </div>
                                            {value?.id === cat.id && (
                                                <Check className="ml-auto h-4 w-4" />
                                            )}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
            ) : (
                <div className="flex items-center justify-between gap-1">
                    {value ? (
                        <Badge
                            variant="secondary"
                            style={value.color ? { backgroundColor: `${value.color}20`, color: value.color } : undefined}
                        >
                            {value.icon && <span className="mr-1">{value.icon}</span>}
                            {value.name}
                        </Badge>
                    ) : (
                        <button
                            type="button"
                            onClick={startEdit}
                            className="text-sm text-muted-foreground italic hover:text-foreground"
                        >
                            {t("detail.addCategory")}
                        </button>
                    )}
                    {value && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={startEdit}
                            className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}

// --- Inline Paid By Field ---

interface InlinePaidByFieldProps {
    value: TeamMemberUser | null
    onChange: (userId: string | null) => void
    isLoading?: boolean
    savingField?: string | null
    members: TeamMemberUser[]
}

function InlinePaidByField({ value, onChange, isLoading, savingField, members }: InlinePaidByFieldProps) {
    const [isEditing, setIsEditing] = useState(false)
    const t = useTranslations("expenses")

    const startEdit = () => {
        if (savingField === "paidByUserId") return
        setIsEditing(true)
    }

    const handleSelect = (userId: string) => {
        onChange(userId)
        setIsEditing(false)
    }

    return (
        <div className="group min-w-0 flex-1">
            {isEditing ? (
                <Popover open={isEditing} onOpenChange={setIsEditing}>
                    <PopoverTrigger asChild>
                        <button type="button" className="w-full text-left">
                            {value ? (
                                <div className="flex items-center gap-2">
                                    {value.image ? (
                                        <img
                                            src={value.image}
                                            alt={value.name}
                                            className="size-6 rounded-full"
                                        />
                                    ) : (
                                        <div className="size-6 rounded-full bg-muted flex items-center justify-center">
                                            <span className="text-xs font-medium">{value.name.charAt(0)}</span>
                                        </div>
                                    )}
                                    <span className="text-sm truncate">{value.name}</span>
                                </div>
                            ) : (
                                <span className="text-sm text-muted-foreground italic">
                                    {t("detail.selectMember")}
                                </span>
                            )}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-0" align="start">
                        <Command>
                            <CommandInput placeholder={t("detail.searchMember")} />
                            <CommandList>
                                <CommandEmpty>{t("detail.noMembersFound")}</CommandEmpty>
                                <CommandGroup>
                                    <CommandItem onSelect={() => handleSelect("")}>
                                        <span className="text-muted-foreground">{t("detail.noMember")}</span>
                                    </CommandItem>
                                    {members.map((member) => (
                                        <CommandItem
                                            key={member.id}
                                            value={member.id}
                                            onSelect={() => handleSelect(member.id)}
                                        >
                                            <div className="flex items-center gap-2">
                                                {member.image ? (
                                                    <img
                                                        src={member.image}
                                                        alt={member.name}
                                                        className="size-6 rounded-full"
                                                    />
                                                ) : (
                                                    <div className="size-6 rounded-full bg-muted flex items-center justify-center">
                                                        <span className="text-xs font-medium">{member.name.charAt(0)}</span>
                                                    </div>
                                                )}
                                                <div className="flex flex-col">
                                                    <span className="truncate">{member.name}</span>
                                                    <span className="text-xs text-muted-foreground">{member.email}</span>
                                                </div>
                                            </div>
                                            {value?.id === member.id && (
                                                <Check className="ml-auto h-4 w-4" />
                                            )}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
            ) : (
                <div className="flex items-center justify-between gap-1">
                    {value ? (
                        <div className="flex items-center gap-2">
                            {value.image ? (
                                <img
                                    src={value.image}
                                    alt={value.name}
                                    className="size-6 rounded-full"
                                />
                            ) : (
                                <div className="size-6 rounded-full bg-muted flex items-center justify-center">
                                    <span className="text-xs font-medium">{value.name.charAt(0)}</span>
                                </div>
                            )}
                            <span className="text-sm truncate">{value.name}</span>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={startEdit}
                            className="text-sm text-muted-foreground italic hover:text-foreground"
                        >
                            {t("detail.addPaidBy")}
                        </button>
                    )}
                    {value && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={startEdit}
                            className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}

// --- Inline Status Field ---

interface InlineStatusFieldProps {
    value: ExpenseStatus
    onChange: (status: ExpenseStatus) => void
    isLoading?: boolean
    savingField?: string | null
}

function InlineStatusField({ value, onChange, isLoading, savingField }: InlineStatusFieldProps) {
    const [isEditing, setIsEditing] = useState(false)
    const t = useTranslations("expenses")

    const statusOptions: { value: ExpenseStatus; label: string }[] = [
        { value: "draft", label: t("status.draft") },
        { value: "pending_approval", label: t("status.pendingApprovalFull") },
        { value: "approved", label: t("status.approved") },
        { value: "rejected", label: t("status.rejected") },
        { value: "paid", label: t("status.paid") },
        { value: "void", label: t("status.void") },
    ]

    const startEdit = () => {
        if (savingField === "status") return
        setIsEditing(true)
    }

    const handleSelect = (status: ExpenseStatus) => {
        onChange(status)
        setIsEditing(false)
    }

    return (
        <div className="group min-w-0 flex-1">
            {isEditing ? (
                <Popover open={isEditing} onOpenChange={setIsEditing}>
                    <PopoverTrigger asChild>
                        <button type="button" className="w-full text-left">
                            <StatusBadge status={value} label={statusOptions.find(s => s.value === value)?.label || value} />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-0" align="start">
                        <Command>
                            <CommandInput placeholder={t("detail.searchStatus")} />
                            <CommandList>
                                <CommandEmpty>{t("detail.noStatusFound")}</CommandEmpty>
                                <CommandGroup>
                                    {statusOptions.map((option) => (
                                        <CommandItem
                                            key={option.value}
                                            value={option.value}
                                            onSelect={() => handleSelect(option.value)}
                                        >
                                            <div className="flex items-center gap-2">
                                                <StatusBadge status={option.value} label="" />
                                                <span>{option.label}</span>
                                            </div>
                                            {value === option.value && (
                                                <Check className="ml-auto h-4 w-4" />
                                            )}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
            ) : (
                <div className="flex items-center justify-between gap-1">
                    <StatusBadge status={value} label={statusOptions.find(s => s.value === value)?.label || value} />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={startEdit}
                        className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100"
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    )
}

// --- Inline Amount (Combo) ---

interface InlineAmountProps {
    amount: string
    currency: string
    amountEur?: string | null
    exchangeRate?: string | null
    onChange: (data: { amount: string; currency: string }) => void
    isLoading?: boolean
    savingField?: string | null
    intlLocale: string
}

function InlineAmount({
    amount,
    currency,
    amountEur,
    exchangeRate,
    onChange,
    isLoading,
    savingField,
    intlLocale,
}: InlineAmountProps) {
    const [draft, setDraft] = useState({ amount, currency })
    const [isEditing, setIsEditing] = useState(false)
    const t = useTranslations("expenses")
    const CURRENCY_OPTIONS = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "MXN", "BRL", "CLP", "COP", "ARS"] as const

    const startEdit = () => {
        if (savingField === "amount" || savingField === "currency") return
        setIsEditing(true)
        setDraft({ amount, currency })
    }

    const cancelEdit = () => {
        setIsEditing(false)
        setDraft({ amount, currency })
    }

    const saveEdit = () => {
        onChange(draft)
        setIsEditing(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault()
            saveEdit()
        }
    }

    return (
        <div className="group min-w-0 flex-1">
            {isEditing ? (
                <div className="flex items-center gap-2 w-full">
                    <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.amount}
                        onChange={(e) => setDraft((prev) => ({ ...prev, amount: e.target.value }))}
                        onKeyDown={handleKeyDown}
                        className="h-9 w-32"
                    />
                    <Select
                        value={draft.currency}
                        onValueChange={(c) => setDraft((prev) => ({ ...prev, currency: c }))}
                    >
                        <SelectTrigger className="w-20">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {CURRENCY_OPTIONS.map((c) => (
                                <SelectItem key={c} value={c}>
                                    {c}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            className="h-6 w-6 text-muted-foreground"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={saveEdit}
                            disabled={isLoading}
                        >
                            <Check className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-1">
                        <p className="text-3xl font-bold text-foreground">
                            {formatAmount(amount, currency, intlLocale)}
                        </p>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={startEdit}
                            className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    </div>
                    {amountEur && currency !== "EUR" && (
                        <button
                            type="button"
                            className="text-sm text-muted-foreground hover:text-foreground text-left"
                        >
                            ≈ {formatAmount(amountEur, "EUR", intlLocale)}
                            {exchangeRate && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                    (1 {currency} = {parseFloat(exchangeRate).toFixed(4)} EUR)
                                </span>
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}

// --- Main Panel Component ---

export function ExpenseDetailPanel({
    open,
    onOpenChange,
    item,
    isLoading,
    onStatusChange,
    onDelete,
    onEdit,
}: ExpenseDetailPanelProps) {
    const t = useTranslations("expenses")
    const locale = useLocale()
    const intlLocale = locale.startsWith("es") ? "es-ES" : "en-US"
    const [savingField, setSavingField] = useState<string | null>(null)

    const { data: categories = [] } = useExpenseCategories()
    const { members } = useTeamMembersSelect()
    const { mutate: updateExpense, isPending: isUpdating } = useUpdateExpense()

    const queryClient = useQueryClient()

    const handleFieldSave = async (field: string, value: unknown) => {
        if (!item) return
        setSavingField(field)
        try {
            await updateExpense({ id: item.id, data: { [field]: value } })
            await queryClient.invalidateQueries({ queryKey: ["expenses"] })
        } finally {
            setSavingField(null)
        }
    }

    const handleTitleSave = (title: string) => handleFieldSave("title", title)
    const handleDescriptionSave = (description: string | null) => handleFieldSave("description", description)
    const handleDateSave = (date: string) => handleFieldSave("expenseDate", date)
    const handleVendorSave = (vendor: string | null) => handleFieldSave("vendor", vendor)
    const handleCategorySave = (categoryId: string | null) => handleFieldSave("categoryId", categoryId)
    const handlePaidBySave = (userId: string | null) => handleFieldSave("paidByUserId", userId)
    const handleStatusFieldSave = (status: ExpenseStatus) => handleFieldSave("status", status)
    const handleAmountSave = (data: { amount: string; currency: string }) => {
        handleFieldSave("amount", data.amount)
        handleFieldSave("currency", data.currency)
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-[500px] overflow-y-auto">
                {isLoading || !item ? (
                    <>
                        <SheetHeader className="sr-only">
                            <SheetTitle>{t("detail.title")}</SheetTitle>
                            <SheetDescription>{t("detail.loadingDescription")}</SheetDescription>
                        </SheetHeader>
                        <DetailPanelSkeleton />
                    </>
                ) : (
                    <>
                        <SheetHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <InlineTitle
                                        value={item.title}
                                        onChange={handleTitleSave}
                                        isLoading={isUpdating}
                                        savingField={savingField}
                                    />
                                </div>
                            </div>
                            <SheetDescription className="sr-only">
                                {t("detail.detailDescription", { title: item.title })}
                            </SheetDescription>
                        </SheetHeader>

                        <div className="flex flex-col gap-5 pt-2">
                            {/* Amount */}
                            <InlineAmount
                                amount={item.amount}
                                currency={item.currency}
                                amountEur={item.amountEur}
                                exchangeRate={item.exchangeRate}
                                onChange={handleAmountSave}
                                isLoading={isUpdating}
                                savingField={savingField}
                                intlLocale={intlLocale}
                            />

                            <Separator />

                            {/* Metadata Section */}
                            <div className="flex flex-col gap-3 text-sm">
                                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                                    {/* Expense Date */}
                                    <InlineMetadataField label={t("detail.date")} icon={<Calendar className="size-4 shrink-0 text-muted-foreground" />}>
                                        <InlineDateField
                                            value={item.expenseDate}
                                            onChange={handleDateSave}
                                            isLoading={isUpdating}
                                            savingField={savingField}
                                        />
                                    </InlineMetadataField>

                                    {/* Vendor */}
                                    <InlineMetadataField label={t("detail.vendor")} icon={<Building2 className="size-4 shrink-0 text-muted-foreground" />}>
                                        <InlineVendorField
                                            value={item.vendor}
                                            onChange={handleVendorSave}
                                            isLoading={isUpdating}
                                            savingField={savingField}
                                        />
                                    </InlineMetadataField>

                                    {/* Category */}
                                    <InlineMetadataField label={t("detail.category")} icon={<Tag className="size-4 shrink-0 text-muted-foreground" />}>
                                        <InlineCategoryField
                                            value={item.category}
                                            onChange={handleCategorySave}
                                            isLoading={isUpdating}
                                            savingField={savingField}
                                            categories={categories}
                                        />
                                    </InlineMetadataField>

                                    {/* Paid By */}
                                    <InlineMetadataField label={t("detail.paidBy")} icon={<User className="size-4 shrink-0 text-muted-foreground" />}>
                                        <InlinePaidByField
                                            value={item.paidByUser}
                                            onChange={handlePaidBySave}
                                            isLoading={isUpdating}
                                            savingField={savingField}
                                            members={members}
                                        />
                                    </InlineMetadataField>

                                    {/* Status */}
                                    <InlineMetadataField label={t("detail.status")} icon={<Tag className="size-4 shrink-0 text-muted-foreground" />}>
                                        <InlineStatusField
                                            value={item.status}
                                            onChange={handleStatusFieldSave}
                                            isLoading={isUpdating}
                                            savingField={savingField}
                                        />
                                    </InlineMetadataField>
                                </div>
                            </div>

                            <Separator />

                            {/* Description */}
                            <div>
                                <p className="text-sm font-medium mb-1.5">{t("detail.description")}</p>
                                <InlineDescription
                                    value={item.description}
                                    onChange={handleDescriptionSave}
                                    isLoading={isUpdating}
                                    savingField={savingField}
                                />
                            </div>

                            {/* Invoice Section */}
                            {item.invoiceFileName && (
                                <>
                                    <Separator />
                                    <div>
                                        <p className="text-sm font-medium mb-2">{t("detail.invoice")}</p>
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center gap-2 text-sm">
                                                <FileText className="size-4 text-muted-foreground shrink-0" />
                                                <span className="truncate">{item.invoiceFileName}</span>
                                                {item.invoiceFileSize && (
                                                    <span className="text-xs text-muted-foreground shrink-0">
                                                        ({formatBytes(item.invoiceFileSize)})
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2 flex-wrap">
                                                {item.invoiceProcessingStatus && (
                                                    <InvoiceProcessingBadge
                                                        processingStatus={item.invoiceProcessingStatus}
                                                        label={t(`invoiceProcessing.${item.invoiceProcessingStatus}`)}
                                                    />
                                                )}
                                                {typeof (item.invoiceProcessedData as Record<string, unknown> | null)?.confidence === "number" && (
                                                    <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                                        {t("detail.aiConfidence", {
                                                            percent: Math.round(
                                                                (item.invoiceProcessedData as Record<string, unknown>).confidence as number * 100
                                                            )
                                                        })}
                                                    </Badge>
                                                )}
                                            </div>

                                            {item.invoiceFileUrl && (
                                                <Button variant="outline" size="sm" className="w-fit" asChild>
                                                    <a href={item.invoiceFileUrl} target="_blank" rel="noopener noreferrer">
                                                        <ExternalLink className="size-4 mr-1" />
                                                        {t("detail.viewInvoice")}
                                                    </a>
                                                </Button>
                                            )}

                                            {/* AI parsed fields */}
                                            {item.invoiceProcessedData &&
                                                typeof item.invoiceProcessedData.fields === "object" &&
                                                item.invoiceProcessedData.fields !== null && (
                                                    <div className="mt-1">
                                                        <p className="text-xs font-medium text-muted-foreground mb-1">{t("detail.aiExtractedData")}</p>
                                                        <div className="rounded-md border bg-muted/30 p-3 flex flex-col gap-1">
                                                            {Object.entries(item.invoiceProcessedData.fields as Record<string, unknown>)
                                                                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                                                                .map(([key, value]) => (
                                                                    <div key={key} className="flex gap-2 text-xs">
                                                                        <span className="font-medium capitalize text-muted-foreground min-w-[100px]">
                                                                            {key.replace(/_/g, " ")}:
                                                                        </span>
                                                                        <span className="text-foreground">{String(value)}</span>
                                                                    </div>
                                                                ))}
                                                        </div>
                                                    </div>
                                                )}
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Tags */}
                            {item.tags.length > 0 && (
                                <>
                                    <Separator />
                                    <div>
                                        <p className="text-sm font-medium mb-2">{t("detail.tags")}</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {item.tags.map((tag) => (
                                                <Badge
                                                    key={tag.id}
                                                    variant="secondary"
                                                    style={tag.color ? { backgroundColor: `${tag.color}20`, color: tag.color } : undefined}
                                                >
                                                    {tag.name}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}

                            <Separator />

                            {/* Timestamps */}
                            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                                <span>{t("detail.createdAt", { date: formatDateTime(item.createdAt, intlLocale) })}</span>
                                <span>{t("detail.updatedAt", { date: formatDateTime(item.updatedAt, intlLocale) })}</span>
                            </div>

                            <Separator />

                            {/* Actions */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={onEdit}>
                                        <Pencil className="size-4 mr-1" />
                                        {t("detail.edit")}
                                    </Button>
                                    <Button variant="destructive" size="sm" onClick={onDelete}>
                                        <Trash2 className="size-4 mr-1" />
                                        {t("detail.delete")}
                                    </Button>
                                </div>

                                {/* Status change buttons */}
                                <div>
                                    <p className="text-sm font-medium mb-1.5">{t("detail.changeStatus")}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {([
                                            { value: "draft", label: t("status.draft") },
                                            { value: "pending_approval", label: t("status.pendingApprovalFull") },
                                            { value: "approved", label: t("status.approved") },
                                            { value: "rejected", label: t("status.rejected") },
                                            { value: "paid", label: t("status.paid") },
                                            { value: "void", label: t("status.void") },
                                        ] as const).map((opt) => (
                                            <Button
                                                key={opt.value}
                                                variant={item.status === opt.value ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => onStatusChange(opt.value)}
                                                disabled={item.status === opt.value}
                                                className="text-xs"
                                            >
                                                {opt.label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    )
}
