import type { CanonicalEventEnvelope } from "@almirant/stream-consumer";

type SkillValidationCanonicalEventParams = {
  jobId: string;
  threadId?: string;
  webSessionId?: string;
  webOrganizationId?: string;
  skillName: string;
  nextSequence: () => number;
  now?: () => number;
};

export const buildSkillValidationCanonicalEvents = ({
  jobId,
  threadId,
  webSessionId,
  webOrganizationId,
  skillName,
  nextSequence,
  now = () => Date.now(),
}: SkillValidationCanonicalEventParams): CanonicalEventEnvelope[] => {
  if (!webSessionId || !webOrganizationId) return [];

  const timestamp = now();
  const toolCallId = `skill-${skillName}-${timestamp}`;
  const inputPreview = `skill: ${skillName}`;
  const effectiveThreadId = threadId ?? "";

  return [
    {
      jobId,
      sessionId: webSessionId,
      organizationId: webOrganizationId,
      threadId: effectiveThreadId,
      timestamp,
      sequenceNumber: nextSequence(),
      event: {
        kind: "agent.tool_call.start",
        toolCallId,
        toolName: "Skill",
        inputPreview,
      },
    },
    {
      jobId,
      sessionId: webSessionId,
      organizationId: webOrganizationId,
      threadId: effectiveThreadId,
      timestamp: timestamp + 1,
      sequenceNumber: nextSequence(),
      event: {
        kind: "agent.tool_call.result",
        toolCallId,
        toolName: "Skill",
        success: true,
      },
    },
  ];
};
