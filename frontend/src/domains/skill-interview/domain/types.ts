export type SkillInterviewMessageRole = "user" | "assistant";

export interface SkillInterviewMessage {
  id: string;
  role: SkillInterviewMessageRole;
  content: string;
  createdAt: string;
}

export interface GeneratedSkillFrontmatter {
  name: string;
  description: string;
  argumentHint: string;
}

export interface GeneratedSkill {
  rawContent: string;
  frontmatter: GeneratedSkillFrontmatter;
  body: string;
}

export interface SkillInterviewChatProps {
  messages: SkillInterviewMessage[];
  draftMessage: string;
  onDraftMessageChange: (value: string) => void;
  onSendMessage: () => void;
  isStreaming: boolean;
  error: string | null;
  generatedSkill: GeneratedSkill | null;
  onBackToChat: () => void;
  onCopySkill: () => Promise<void>;
  onDownloadSkill: () => void;
  hasCopiedSkill: boolean;
}

export interface SkillPreviewProps {
  skill: GeneratedSkill;
  onBackToChat: () => void;
  onCopySkill: () => Promise<void>;
  onDownloadSkill: () => void;
  hasCopiedSkill: boolean;
}
