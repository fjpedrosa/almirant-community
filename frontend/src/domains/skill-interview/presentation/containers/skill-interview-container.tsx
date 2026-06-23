"use client";

import { useSkillInterview } from "../../application/hooks/use-skill-interview";
import { SkillInterviewChat } from "../components/skill-interview-chat";

export const SkillInterviewContainer: React.FC = () => {
  const {
    messages,
    draftMessage,
    isStreaming,
    error,
    generatedSkill,
    hasCopiedSkill,
    sendMessage,
    setDraftMessage,
    clearGeneratedSkill,
    copyGeneratedSkill,
    downloadGeneratedSkill,
  } = useSkillInterview();

  return (
    <SkillInterviewChat
      messages={messages}
      draftMessage={draftMessage}
      onDraftMessageChange={setDraftMessage}
      onSendMessage={sendMessage}
      isStreaming={isStreaming}
      error={error}
      generatedSkill={generatedSkill}
      onBackToChat={clearGeneratedSkill}
      onCopySkill={copyGeneratedSkill}
      onDownloadSkill={downloadGeneratedSkill}
      hasCopiedSkill={hasCopiedSkill}
    />
  );
};
