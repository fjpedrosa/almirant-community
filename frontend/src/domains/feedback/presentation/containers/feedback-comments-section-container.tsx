"use client";

import { UnifiedCommentSection } from "@/domains/shared/presentation/components/unified-comment-section";
import { useFeedbackComments } from "../../application/hooks/use-feedback-comments";
import { useFeedbackMentionMembers } from "../../application/hooks/use-feedback-mention-members";
import type { FeedbackMentionMemberSource } from "../../application/mention-member-source";

interface FeedbackCommentsSectionContainerProps {
  feedbackItemId: string;
  currentUserId: string | null;
  mentionMemberSource?: FeedbackMentionMemberSource;
}

export const FeedbackCommentsSectionContainer: React.FC<FeedbackCommentsSectionContainerProps> = ({
  feedbackItemId,
  currentUserId,
  mentionMemberSource,
}) => {
  const {
    comments,
    isLoading,
    isAdding,
    newCommentValue,
    editingId,
    editContent,
    onNewCommentChange,
    onAddComment,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onEditContentChange,
    onDeleteComment,
  } = useFeedbackComments(feedbackItemId);

  const { mentionMembers } = useFeedbackMentionMembers(mentionMemberSource);

  return (
    <UnifiedCommentSection
      comments={comments}
      isLoading={isLoading}
      currentUserId={currentUserId}
      isAdding={isAdding}
      newCommentValue={newCommentValue}
      editingId={editingId}
      editContent={editContent}
      members={mentionMembers}
      onAddComment={onAddComment}
      onDeleteComment={onDeleteComment}
      onNewCommentChange={onNewCommentChange}
      onStartEdit={onStartEdit}
      onCancelEdit={onCancelEdit}
      onSaveEdit={onSaveEdit}
      onEditContentChange={onEditContentChange}
    />
  );
};
