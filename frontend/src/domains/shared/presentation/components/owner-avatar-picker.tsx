import { useState } from "react";
import { Check, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { OwnerAvatarPickerProps } from "../../domain/types";

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const sizeClasses = {
  sm: {
    avatar: "h-6 w-6",
    fallbackText: "text-[10px]",
    placeholder: "h-6 w-6",
    placeholderIcon: "h-3 w-3",
  },
  md: {
    avatar: "h-8 w-8",
    fallbackText: "text-xs",
    placeholder: "h-8 w-8",
    placeholderIcon: "h-4 w-4",
  },
} as const;

export const OwnerAvatarPicker: React.FC<OwnerAvatarPickerProps> = ({
  currentOwnerId,
  members,
  onOwnerChange,
  size = "sm",
  disabled = false,
}) => {
  const currentOwner = currentOwnerId
    ? members.find((m) => m.id === currentOwnerId)
    : null;

  const classes = sizeClasses[size];
  const [open, setOpen] = useState(false);

  if (disabled) {
    return currentOwner ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled
            className={cn(
              "rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-not-allowed opacity-50",
            )}
            aria-label={`Asignado a ${currentOwner.name}.`}
          >
            <Avatar className={classes.avatar}>
              <AvatarImage
                src={currentOwner.image ?? undefined}
                alt={currentOwner.name}
              />
              <AvatarFallback className={classes.fallbackText}>
                {getInitials(currentOwner.name)}
              </AvatarFallback>
            </Avatar>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{currentOwner.name}</TooltipContent>
      </Tooltip>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled
            className={cn(
              "flex items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60 cursor-not-allowed opacity-50",
              classes.placeholder,
            )}
            aria-label="Sin asignar."
          >
            <User className={classes.placeholderIcon} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Asignar responsable</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {currentOwner ? (
              <button
                type="button"
                className={cn(
                  "cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
                aria-label={`Asignado a ${currentOwner.name}. Haz clic para cambiar.`}
              >
                <Avatar className={classes.avatar}>
                  <AvatarImage
                    src={currentOwner.image ?? undefined}
                    alt={currentOwner.name}
                  />
                  <AvatarFallback className={classes.fallbackText}>
                    {getInitials(currentOwner.name)}
                  </AvatarFallback>
                </Avatar>
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  "flex cursor-pointer items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60 transition-colors hover:border-muted-foreground hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  classes.placeholder,
                )}
                aria-label="Sin asignar. Haz clic para asignar."
              >
                <User className={classes.placeholderIcon} />
              </button>
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {currentOwner ? currentOwner.name : "Asignar responsable"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-56 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
          Asignar responsable
        </div>
        <ScrollArea className="max-h-56">
          <div className="px-1 pb-1">
            {members.map((member) => {
              const isSelected = member.id === currentOwnerId;
              return (
                <button
                  key={member.id}
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:bg-accent",
                    isSelected && "bg-accent/50",
                  )}
                  onClick={() => {
                    onOwnerChange(member.id);
                    setOpen(false);
                  }}
                  aria-label={`Asignar a ${member.name}`}
                >
                  <Avatar className="h-6 w-6 shrink-0">
                    {member.image && (
                      <AvatarImage src={member.image} alt={member.name} />
                    )}
                    <AvatarFallback className="text-[10px]">
                      {getInitials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{member.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  </div>
                  {isSelected && (
                    <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
