// Compatibility boundary for existing API callers. The implementation lives
// in shared so validation and database execution cannot drift again.
export {
  AI_PROVIDER_BY_AGENT_PROVIDER,
  collectScheduledAgentConnectionRuntimes,
  collectScheduledAgentEffectiveModels,
  normalizeScheduledAgentModel,
  resolveScheduledAgentAiProvider,
} from "@almirant/shared";
