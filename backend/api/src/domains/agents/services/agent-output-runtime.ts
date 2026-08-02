import {
  findAgentOutputCapabilityByJobId,
  submitAgentOutput,
} from "@almirant/database";
import {
  createAgentOutputCapabilityService,
  type AgentOutputCapabilityRecord,
} from "./agent-output-capability";

export const agentOutputCapabilityService =
  createAgentOutputCapabilityService({
    findByJobId: async (jobId) =>
      (await findAgentOutputCapabilityByJobId(
        jobId,
      )) as AgentOutputCapabilityRecord | null,
    submit: async ({ canonicalPayload: _canonicalPayload, ...input }) => {
      const submitted = await submitAgentOutput(input);
      return {
        submissionId: submitted.submissionId,
        replay: submitted.replay,
      };
    },
  });
