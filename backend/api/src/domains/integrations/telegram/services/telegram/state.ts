type ChatState = {
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeBoardId: string | null;
  activeBoardName: string | null;
};

const defaultState = (): ChatState => ({
  activeProjectId: null,
  activeProjectName: null,
  activeBoardId: null,
  activeBoardName: null,
});

const stateByChatId = new Map<string, ChatState>();

export const telegramState = {
  get(chatId: string): ChatState {
    const existing = stateByChatId.get(chatId);
    if (existing) return existing;
    const next = defaultState();
    stateByChatId.set(chatId, next);
    return next;
  },

  setActiveProject(chatId: string, project: { id: string; name: string } | null): void {
    const st = telegramState.get(chatId);
    st.activeProjectId = project?.id ?? null;
    st.activeProjectName = project?.name ?? null;
  },

  setActiveBoard(chatId: string, board: { id: string; name: string } | null): void {
    const st = telegramState.get(chatId);
    st.activeBoardId = board?.id ?? null;
    st.activeBoardName = board?.name ?? null;
  },
};

