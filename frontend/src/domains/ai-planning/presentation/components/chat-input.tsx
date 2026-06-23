import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Square, X, Check, Plus, MessageSquareText, Timer, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioWaveform } from "./audio-waveform";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { MicrophoneButton } from "./microphone-button";
import { useCountdownTimer } from "../../application/hooks/use-countdown-timer";
import type { ChatInputProps } from "../../domain/types";

// Fully controlled chat input — all state managed by parent via props.
//
// Usage:
// <ChatInput
//   onSend={handleSend}
//   value={input.value}
//   onChange={input.onChange}
//   canSend={input.canSend}
//   onSendAction={input.onSend}
//   onKeyDown={input.onKeyDown}
//   isRecording={voice.isRecording}
//   isTranscribing={voice.isTranscribing}
//   isVoiceSupported={voice.isSupported}
//   onStartRecording={voice.startRecording}
//   onStopRecording={voice.stopRecording}
// />

export const ChatInput: React.FC<ChatInputProps> = ({
  disabled = false,
  placeholder,
  isStreaming = false,
  toolbar,
  value = "",
  onChange,
  canSend = false,
  onSendAction,
  onStop,
  onKill,
  onPause,
  isPaused = false,
  onKeyDown,
  isRecording = false,
  isTranscribing = false,
  isVoiceSupported = false,
  onStartRecording,
  onStopRecording,
  mediaStream,
  mobileCompact = true,
  followUpHint,
  expiresAt,
}) => {
  const t = useTranslations("aiPlanning");
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const countdown = useCountdownTimer(expiresAt ?? null);
  const canKill = typeof onKill === "function";

  const killButtonMobile = canKill ? (
    <Button
      onClick={() => setShowKillConfirm(true)}
      variant="outline"
      size="icon"
      className="rounded-full shrink-0 size-11 border-border text-destructive hover:text-red-400"
      aria-label={t("killSession")}
    >
      <Power className="size-5" />
    </Button>
  ) : null;

  const killButtonDesktop = canKill ? (
    <Button
      onClick={() => setShowKillConfirm(true)}
      variant="ghost"
      size="icon"
      className="rounded-full shrink-0 size-10 text-destructive hover:text-red-400"
      aria-label={t("killSession")}
    >
      <Power className="size-5" />
    </Button>
  ) : null;

  const handleMicClick = () => {
    if (isRecording) {
      onStopRecording?.();
    } else {
      onStartRecording?.();
    }
  };

  const sendOrStopButton = isStreaming && value ? (
    // During streaming with text: show send (queued) button
    <Button
      onClick={onSendAction}
      disabled={!canSend || isRecording || isTranscribing}
      size="icon"
      className="rounded-full shrink-0 size-7 md:size-10"
      aria-label={t("sendMessage")}
    >
      <ArrowUp className="size-4 md:size-5" />
    </Button>
  ) : isStreaming ? (
    <Button
      onClick={onStop}
      size="icon"
      className="rounded-full shrink-0 size-7 md:size-10 bg-primary/60 text-primary-foreground hover:bg-primary/50"
      aria-label="Stop"
    >
      <Square className="size-3 md:size-4" />
    </Button>
  ) : (
    <Button
      onClick={onSendAction}
      disabled={!canSend || isRecording || isTranscribing}
      size="icon"
      className="rounded-full shrink-0 size-7 md:size-10"
      aria-label={t("sendMessage")}
    >
      <ArrowUp className="size-4 md:size-5" />
    </Button>
  );

  return (
    <div className="px-2 md:px-4 pt-1 pb-2 md:pb-3 shrink-0" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
      {/* ===== Mobile layout: [+] [input with mic/send] ===== */}
      <div className={mobileCompact ? "md:hidden" : "hidden"}>
        <div className="flex items-center gap-1.5 max-w-3xl mx-auto">
          {killButtonMobile}
          {/* (+) action button */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="rounded-full shrink-0 size-11 border-border"
                aria-label={t("actions")}
              >
                <Plus className="size-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto p-1">
              {toolbar}
            </PopoverContent>
          </Popover>

          {/* Input bubble — starts as pill, grows to rounded-2xl when multiline */}
          <div className={cn(
            "flex-1 border border-border bg-accent pl-3 pr-1.5 min-h-11 flex min-w-0 overflow-hidden",
            value && value.length > 40 ? "rounded-2xl items-end py-1.5" : "rounded-full items-center",
          )}>
            {isRecording ? (
              <div className="flex items-center gap-1 w-full py-1">
                <div className="flex-1 h-7 overflow-hidden rounded-lg">
                  <AudioWaveform mediaStream={mediaStream ?? null} barCount={30} />
                </div>
                <Button
                  onClick={() => { onStopRecording?.(); onChange?.(""); }}
                  size="icon"
                  variant="ghost"
                  className="rounded-full size-9 text-muted-foreground shrink-0"
                  aria-label={t("cancel")}
                >
                  <X className="size-4" />
                </Button>
                <Button
                  onClick={() => onStopRecording?.()}
                  size="icon"
                  className="rounded-full size-9 shrink-0"
                  aria-label={t("sendMessage")}
                >
                  <Check className="size-4" />
                </Button>
              </div>
            ) : (
              <div className={cn(
                "flex gap-1 w-full min-w-0",
                value && value.length > 40 ? "items-end" : "items-center",
              )}>
                <Textarea
                  value={value}
                  onChange={(e) => onChange?.(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={isPaused ? t("pausedPlaceholder") : (placeholder ?? t("placeholder"))}
                  disabled={disabled}
                  autoComplete="off"
                  className="border-0 shadow-none focus-visible:ring-0 bg-transparent! min-h-[42px] max-h-[120px] resize-none px-0 py-[9px] text-base leading-normal break-words overflow-x-hidden [overflow-wrap:anywhere]"
                  rows={1}
                />
                {isVoiceSupported && !value && (
                  <MicrophoneButton
                    isRecording={isRecording}
                    isTranscribing={isTranscribing}
                    isSupported={isVoiceSupported}
                    onClick={handleMicClick}
                    disabled={disabled}
                    className="size-11 shrink-0"
                  />
                )}
                {value && (
                  <div className="shrink-0">
                    <Button
                      onClick={onSendAction}
                      disabled={!canSend || isRecording || isTranscribing}
                      size="icon"
                      className="rounded-full shrink-0 size-11"
                      aria-label={t("sendMessage")}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== Desktop layout (+ mobile non-compact): original stacked design ===== */}
      <div className={mobileCompact ? "hidden md:block" : "block"}>
        <div className="max-w-3xl mx-auto rounded-2xl border-2 border-border bg-accent p-3">
          {isRecording ? (
            <>
              <div className="flex justify-center">
                <div className="h-8 w-1/2 max-w-sm overflow-hidden rounded-lg">
                  <AudioWaveform mediaStream={mediaStream ?? null} barCount={24} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-2">
                <Button
                  onClick={() => { onStopRecording?.(); onChange?.(""); }}
                  size="icon"
                  variant="ghost"
                  className="rounded-full shrink-0 size-10 text-muted-foreground hover:text-foreground"
                  aria-label={t("cancel")}
                >
                  <X className="size-5" />
                </Button>
                <Button
                  onClick={() => onStopRecording?.()}
                  size="icon"
                  className="rounded-full shrink-0 size-10"
                  aria-label={t("sendMessage")}
                >
                  <Check className="size-5" />
                </Button>
              </div>
            </>
          ) : (
            <>
              {(followUpHint || countdown.isActive) && (
                <div className="flex items-center justify-between gap-1.5 px-1 pb-1.5 mb-1 border-b border-primary/15">
                  {followUpHint && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MessageSquareText className="size-3.5 text-primary shrink-0" />
                      <p className="text-xs text-primary truncate">{followUpHint}</p>
                    </div>
                  )}
                  {countdown.isActive && (
                    <div className={cn(
                      "inline-flex items-center gap-1 shrink-0 text-xs font-medium tabular-nums",
                      countdown.isCritical
                        ? "text-red-600 dark:text-red-400"
                        : countdown.isWarning
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    )}>
                      <Timer className="size-3" />
                      <span>{countdown.formatted}</span>
                    </div>
                  )}
                </div>
              )}
              <Textarea
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={isPaused ? t("pausedPlaceholder") : (placeholder ?? t("placeholder"))}
                disabled={disabled}
                autoFocus
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                className="border-0 shadow-none focus-visible:ring-0 bg-transparent! min-h-[44px] max-h-[200px] resize-none px-1 py-0 text-[1rem] md:text-[1rem]"
                rows={1}
              />
              <div className="flex items-center justify-between mt-2">
                <div>{toolbar}</div>
                <div className="flex items-center gap-2">
                  {killButtonDesktop}
                  {isVoiceSupported && (
                    <MicrophoneButton
                      isRecording={isRecording}
                      isTranscribing={isTranscribing}
                      isSupported={isVoiceSupported}
                      onClick={handleMicClick}
                      disabled={disabled}
                      className="size-10"
                    />
                  )}
                  {sendOrStopButton}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Kill confirmation dialog */}
      <AlertDialog open={showKillConfirm} onOpenChange={setShowKillConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("killConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("killConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("killConfirmCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onKill?.();
                setShowKillConfirm(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("killConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
