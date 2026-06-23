import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { PanelLeftOpen, Pause, Play, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { SessionSidebar } from "../components/session-sidebar";
import { ModelFloatingSelector } from "../components/model-floating-selector";
import { SessionSearchDialog } from "../components/session-search-dialog";
import { ChatFullPanel } from "../components/chat-full-panel";
import { EmptySessionState } from "../components/empty-session-state";
import { WelcomeScreen } from "../components/welcome-screen";
import { ChatInputToolbar } from "../components/chat-input-toolbar";
import { SeedImportDialog } from "../components/seed-import-dialog";
import { SeedEnrichmentList } from "../components/seed-enrichment-list";
import { SeedDetailOverlay } from "../components/seed-detail-view";
import { SeedReferenceChips } from "../components/seed-reference-chips";
import { usePlanChatPage } from "../../application/hooks/use-plan-chat-page";
import { UnifiedMobileDrawer } from "../components/unified-mobile-drawer";
import { useNavigation } from "@/app/(app-shell)/(dashboard)/components/hooks/use-navigation";
import { useWelcomeScreen } from "../../application/hooks/use-welcome-screen";
import { useAutoScroll } from "../../application/hooks/use-auto-scroll";
import { useThinkingBlock } from "../../application/hooks/use-thinking-block";
import { useChatInput } from "../../application/hooks/use-chat-input";
import { useQuestionCard } from "../../application/hooks/use-question-card";
import { useVoiceRecorder } from "../../application/hooks/use-voice-recorder";
import { AlmirantLogo } from "@/components/icons/almirant-logo";
import { TopNavUserAvatar } from "@/app/(app-shell)/(dashboard)/components/top-nav-user-avatar";
import { PendingQuestionsContainer } from "@/domains/agents/presentation/containers/pending-questions-container";
import { NotificationBellContainer } from "@/domains/notifications/presentation/containers/notification-bell-container";
import { UsageNavButtonContainer } from "@/app/(app-shell)/(dashboard)/components/usage-nav-button-container";

// Container: PlanChatPageContainer
// Wires the usePlanChatPage orchestrator hook to presentational components.
//
// Layout:
// Desktop: Sidebar (collapsible left) | Chat/EmptyState (right) with floating model selector
// Mobile: Sidebar as Sheet drawer

export const PlanChatPageContainer: React.FC = () => {
  const t = useTranslations("aiPlanning");
  const page = usePlanChatPage();
  const { activeTab } = useNavigation();

  // Welcome screen hook — active during the "booting" phase
  const isBooting = page.session.isStarting && !page.session.isSessionActive;
  const welcome = useWelcomeScreen(
    isBooting ? page.session.sessionId : null,
    page.messages.activeProjectName,
    page.seeds.seedCount,
  );

  // Auto-scroll hook — bottomRef passed down to ChatMessageList
  // resetKey = sessionId so that switching sessions resets scroll state
  const autoScroll = useAutoScroll([
    page.messages.items.length,
    page.messages.streamingContent,
    page.messages.streamingThinkingContent,
    page.messages.streamingBlocks?.length,
    page.question.pendingQuestion?.questionId,
    page.messages.pendingUserMessage?.content,
  ], page.session.sessionId);

  // Thinking block collapse state — manages collapse per message ID
  const thinkingBlock = useThinkingBlock();

  // Chat input hook — manages input state for ChatInput
  const chatInput = useChatInput(
    page.messages.sendMessage,
    false,
    page.seeds.attachedSeeds.length > 0,
    page.session.sessionId,
  );

  // Voice recorder hook — handles audio recording and transcription
  // Routes transcript to question wizard textarea when a question is pending.
  const wizardTranscriptRef = useRef<((text: string) => void) | null>(null);
  const handleTranscript = useCallback(
    (text: string) => {
      if (wizardTranscriptRef.current) {
        wizardTranscriptRef.current(text);
        return;
      }
      const currentValue = chatInput.value;
      const newValue = currentValue ? `${currentValue} ${text}` : text;
      chatInput.onChange(newValue);
    },
    [chatInput],
  );

  const voiceRecorder = useVoiceRecorder(handleTranscript);

  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Question card hook — manages form submission for QuestionCard
  const questionCard = useQuestionCard(
    page.question.pendingQuestion && page.question.sendAnswer
      ? (text: string) =>
          page.question.sendAnswer(
            page.question.pendingQuestion!.questionId,
            text,
          )
      : () => {},
  );

  const hasMessages = page.messages.items.length > 0 || page.messages.isStreaming;
  const showChat = page.session.isSessionActive || hasMessages || page.session.showChatPanel;

  // Prevent browser auto-scroll on focus within overflow:hidden containers
  const preventAutoScroll = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const handler = () => { node.scrollTop = 0; };
    node.addEventListener("scroll", handler, { passive: true });
    return () => node.removeEventListener("scroll", handler);
  }, []);

  return (
    <div ref={preventAutoScroll} className="flex h-full w-full overflow-hidden">
      {/* ===== Desktop sidebar ===== */}
      <div className="hidden min-h-0 md:flex">
        <SessionSidebar
          isOpen={page.sidebar.isOpen}
          groups={page.sidebar.groups}
          activeSessionId={page.sidebar.activeSessionId}
          onToggle={page.sidebar.onToggle}
          onSessionClick={page.sidebar.onSessionClick}
          onSessionDelete={page.sidebar.onSessionDelete}
          onSessionResume={page.sidebar.onSessionResume}
          onNewSession={page.session.onNewSession}
          onSearchOpen={() => setIsSearchOpen(true)}
        />
      </div>

      {/* ===== Mobile: Unified drawer for all variants ===== */}
      <div className="md:hidden">
        <UnifiedMobileDrawer
          isOpen={page.layout.isMobileSidebarOpen}
          onOpenChange={page.layout.setMobileSidebarOpen}
          activeTab={activeTab}
          groups={page.sidebar.groups}
          activeSessionId={page.sidebar.activeSessionId}
          onSessionClick={page.sidebar.onSessionClick}
          onSessionDelete={page.sidebar.onSessionDelete}
          onSessionResume={page.sidebar.onSessionResume}
          onNewSession={page.session.onNewSession}
          onSearchOpen={() => setIsSearchOpen(true)}
          modelLabel={
            page.messages.modelSelectorProps.selectedModel ||
            page.messages.activeModelLabel
          }
        />
      </div>

      {/* ===== Main area ===== */}
      <div className="relative flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Mobile header — immersive: logo + icons, no top bar */}
        <div className="md:hidden">
          <div className="flex items-center justify-between px-3 h-12 border-b border-border bg-card">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                onClick={page.layout.onToggleMobileSidebar}
                aria-label="Menu"
              >
                <PanelLeftOpen className="size-5" />
              </Button>
              <AlmirantLogo className="h-5 w-5" />
              <span className="font-semibold text-sm">Almirant</span>
            </div>
            <div className="flex items-center gap-1">
              <PendingQuestionsContainer />
              <UsageNavButtonContainer />
              <NotificationBellContainer />
              <TopNavUserAvatar />
            </div>
          </div>
        </div>

        <div className="h-14 shrink-0">
          <ModelFloatingSelector
            providerKeys={page.messages.modelSelectorProps.providerKeys}
            selectedKeyId={page.messages.modelSelectorProps.selectedKeyId}
            selectedModel={page.messages.modelSelectorProps.selectedModel}
            availableModels={page.messages.modelSelectorProps.availableModels}
            hasKeys={page.messages.modelSelectorProps.hasKeys}
            isLoading={page.messages.modelSelectorProps.isLoading}
            onKeyChange={page.messages.modelSelectorProps.onKeyChange}
            onModelChange={page.messages.modelSelectorProps.onModelChange}
            isSessionActive={page.session.isSessionActive}
            isSessionCompleted={page.session.isCompleted}
            activeModelLabel={page.messages.activeModelLabel}
            isSidebarOpen={page.sidebar.isOpen}
            selectedCodingAgent={page.messages.selectedCodingAgent}
            onCodingAgentChange={page.messages.handleCodingAgentChange}
          />
        </div>

        {/* Pause/Play & Kill buttons — badge style, top-right */}
        {/* Show during streaming, when paused, or in any transient/active session state so the user always has access to Kill */}
        {((page.messages.isStreaming || page.messages.isPaused || page.session.isSessionActive || page.session.isInterrupted || !!page.question.pendingQuestion || !!page.session.pendingFollowUp || page.session.isStarting) && !page.session.isCompleted && !page.session.isSessionEnded) && (
          <div className="absolute top-14 md:top-3 right-3 md:right-4 z-10">
            <div className="inline-flex items-center gap-0.5 rounded-full bg-accent backdrop-blur-sm border border-border/50 px-1 h-11 md:h-8 shadow-sm">
              {page.messages.isPaused ? (
                <>
                  <span className="text-xs text-amber-500 pl-2 pr-1 font-medium">{t("paused")}</span>
                  <Button
                    onClick={() => page.messages.sendMessage(t("resumeDefaultMessage"))}
                    size="icon"
                    variant="ghost"
                    className="rounded-full shrink-0 size-10 md:size-7 text-primary hover:text-primary/80"
                    aria-label={t("resumeSession")}
                  >
                    <Play className="size-4 md:size-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  {page.messages.isStreaming && page.messages.onPause && (
                    <Button
                      onClick={page.messages.onPause}
                      size="icon"
                      variant="ghost"
                      className="rounded-full shrink-0 size-10 md:size-7 text-muted-foreground hover:text-foreground"
                      aria-label={t("pauseSession")}
                    >
                      <Pause className="size-4 md:size-3.5" />
                    </Button>
                  )}
                  {page.messages.onKill && (
                    <Button
                      onClick={page.messages.onKill}
                      size="icon"
                      variant="ghost"
                      className="rounded-full shrink-0 size-10 md:size-7 text-destructive hover:text-red-400"
                      aria-label={t("killSession")}
                    >
                      <Power className="size-4 md:size-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Content area: enrichment phase, chat panel, or empty state */}
        {page.seeds.isEnrichingPhase ? (
          <SeedEnrichmentList
            seeds={page.seeds.attachedSeeds}
            annotations={page.seeds.annotations}
            onAnnotationChange={page.seeds.onAnnotationChange}
            onSeedClick={page.seeds.enrichment.openDetail}
            onRemoveSeed={page.seeds.onRemoveSeed}
            onAddMore={page.seeds.seedImport.open}
            onStart={page.session.onStartSession}
            isStarting={page.session.isStarting}
          />
        ) : page.session.isLoadingFromUrl ? (
          /* Skeleton while loading session from URL */
          <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
            {/* Chat messages skeleton */}
            <div className="flex-1 overflow-hidden p-4 space-y-4">
              {/* Assistant message skeleton */}
              <div className="flex gap-3">
                <Skeleton className="size-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-2 max-w-xl">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              </div>
              {/* User message skeleton */}
              <div className="flex justify-end">
                <div className="space-y-2 max-w-md">
                  <Skeleton className="h-4 w-48 ml-auto" />
                  <Skeleton className="h-4 w-32 ml-auto" />
                </div>
              </div>
              {/* Another assistant message skeleton */}
              <div className="flex gap-3">
                <Skeleton className="size-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-2 max-w-xl">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            </div>
            {/* Input area skeleton */}
            <div className="border-t border-border p-4">
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          </div>
        ) : showChat || isBooting ? (
          <>
          {/* Post-send reference chips */}
          {page.session.isSessionActive && page.seeds.attachedSeeds.length > 0 && page.seeds.hasInjectedSeeds && (
            <SeedReferenceChips
              seeds={page.seeds.attachedSeeds}
              annotations={page.seeds.annotations}
              onChipClick={page.seeds.enrichment.openDetail}
            />
          )}
          <ChatFullPanel
            providerLabel={page.messages.providerLabel}
            model={page.messages.selectedModel}
            showModelBadge={page.messages.showModelBadge}
            messages={page.messages.items}
            streamingContent={page.messages.streamingContent}
            streamingThinkingContent={page.messages.streamingThinkingContent}
            streamingBlocks={page.messages.streamingBlocks}
            completedTurnBlocks={page.messages.completedTurnBlocks}
            isStreaming={page.messages.isStreaming}
            onSendMessage={page.messages.sendMessage}
            showGeneration={page.generation.show}
            previewItems={page.generation.previewItems}
            columns={page.generation.columns}
            activeColumnId={page.generation.activeColumnId}
            activeItemCount={page.generation.activeItemCount}
            isConfirming={page.generation.isConfirming}
            onUpdateItem={page.generation.updateItem}
            onRemoveItem={page.generation.removeItem}
            onColumnChange={page.generation.onColumnChange}
            onConfirmGeneration={page.generation.onConfirm}
            onCancelGeneration={page.session.onCancelGeneration}
            isAlreadyCreated={page.generation.isAlreadyCreated}
            pendingQuestion={page.question.pendingQuestion}
            onAnswerQuestion={page.question.sendAnswer}
            bottomRef={autoScroll.bottomRef}
            scrollRef={autoScroll.scrollRef}
            showScrollToBottom={autoScroll.showScrollToBottom}
            onScrollToBottom={autoScroll.scrollToBottom}
            thinkingBlockIsCollapsed={thinkingBlock.isCollapsed}
            thinkingBlockToggleCollapse={thinkingBlock.toggleCollapse}
            chatInputValue={chatInput.value}
            chatInputOnChange={chatInput.onChange}
            chatInputCanSend={chatInput.canSend}
            chatInputOnSend={chatInput.onSend}
            chatInputOnKeyDown={chatInput.onKeyDown}
            totalTokens={page.messages.totalTokens}
            latestActivity={page.messages.latestActivity}
            onStop={page.messages.onStop}
            onKill={page.messages.onKill}
            onPause={page.messages.onPause}
            isPaused={page.messages.isPaused}
            questionInputRef={questionCard.inputRef}
            questionOnFormSubmit={questionCard.onFormSubmit}
            isSessionCompleted={page.session.isCompleted}
            completedWorkItems={page.session.completedWorkItems}
            completedWorkItemCount={page.session.completedWorkItemCount}
            pendingUserMessage={page.messages.pendingUserMessage ? {
              content: page.messages.pendingUserMessage.content,
              createdAt: page.messages.pendingUserMessage.createdAt,
            } : null}
            isRecording={voiceRecorder.isRecording}
            isTranscribing={voiceRecorder.isTranscribing}
            isVoiceSupported={voiceRecorder.isSupported}
            onStartRecording={voiceRecorder.startRecording}
            onStopRecording={voiceRecorder.stopRecording}
            mediaStream={voiceRecorder.mediaStream}
            wizardTranscriptRef={wizardTranscriptRef}
            isInterrupted={page.session.isInterrupted}
            isResuming={page.session.isResuming}
            interruptionReason={page.session.interruptionReason}
            resumeStep={page.session.resumeStep}
            onResume={page.session.onResume}
            isSessionEnded={page.session.isSessionEnded}
            sessionEndReason={page.session.endReason}
            onRestartSession={page.session.onRestartSession}
            onNewSession={page.session.onNewSession}
            isRestarting={page.session.isStarting}
            pendingFollowUp={page.session.pendingFollowUp}
            followUpPrompt={page.session.followUpPrompt}
            onFeedback={page.messages.onFeedback}
            expiresAt={page.session.expiresAt}
            toolbar={
              <ChatInputToolbar
                onSeedsClick={page.seeds.seedImport.open}
                attachedSeeds={page.seeds.hasInjectedSeeds ? [] : page.seeds.attachedSeeds.map((s) => ({
                  id: s.id,
                  title: s.title,
                }))}
                onRemoveSeed={page.seeds.onRemoveSeed}
              />
            }
          />
          </>
        ) : isBooting ? (
          <WelcomeScreen
            welcomeMessage={welcome.welcomeMessage}
            isLoadingWelcome={welcome.isLoadingWelcome}
            bootPhase={welcome.bootPhase}
            suggestions={welcome.suggestions}
            onSuggestionClick={page.messages.sendMessage}
          />
        ) : (
          <EmptySessionState
            onStartSession={page.session.onStartSession}
            isStarting={page.session.isStarting}
            projects={page.header.projects}
            selectedProjectId={page.header.selectedProjectId}
            isLoadingProjects={page.header.isLoadingProjects}
            onProjectChange={page.header.onProjectChange}
          />
        )}
      </div>

      <SessionSearchDialog
        isOpen={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        groups={page.sidebar.groups}
        onSessionClick={(id) => {
          page.sidebar.onSessionClick(id);
          setIsSearchOpen(false);
        }}
      />

      {/* ===== Session conflict dialog ===== */}
      <AlertDialog
        open={page.session.conflictDialog?.isOpen}
        onOpenChange={(open) => {
          if (!open) page.session.conflictDialog?.onCancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("session.conflictTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("session.conflictDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={page.session.conflictDialog?.onCancel}>
              {t("session.conflictCancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={page.session.conflictDialog?.onConfirm}>
              {t("session.conflictConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== Seed import dialog (modal) ===== */}
      <SeedImportDialog
        isOpen={page.seeds.seedImport.isOpen}
        onClose={page.seeds.seedImport.close}
        seeds={page.seeds.seedImport.seeds}
        isLoading={page.seeds.seedImport.isLoading}
        selectedIds={page.seeds.seedImport.selectedIds}
        selectedCount={page.seeds.seedImport.selectedCount}
        searchQuery={page.seeds.seedImport.searchQuery}
        onSearchChange={page.seeds.seedImport.setSearchQuery}
        onToggle={page.seeds.seedImport.handleToggle}
        onSelectAll={page.seeds.seedImport.handleSelectAll}
        onDeselectAll={page.seeds.seedImport.handleDeselectAll}
        onImport={page.seeds.seedImport.handleImport}
        filtersConfig={page.seeds.seedImport.filtersConfig}
        dynamicFilters={page.seeds.seedImport.dynamicFilters}
        hasActiveFilters={page.seeds.seedImport.hasActiveFilters}
      />

      {/* ===== Seed detail overlay ===== */}
      <SeedDetailOverlay
        isOpen={page.seeds.enrichment.isDetailOpen}
        onClose={page.seeds.enrichment.closeDetail}
        seed={page.seeds.enrichment.detailSeed}
        annotation={
          page.seeds.enrichment.detailSeed
            ? (page.seeds.annotations[page.seeds.enrichment.detailSeed.id] ?? "")
            : undefined
        }
        onAnnotationChange={
          page.session.isSessionActive ? undefined : page.seeds.onAnnotationChange
        }
        readOnly={!!page.session.isSessionActive}
        comments={page.seeds.enrichment.comments}
        isLoadingComments={page.seeds.enrichment.isLoadingComments}
      />
    </div>
  );
};
