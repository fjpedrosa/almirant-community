/**
 * Immutable, secret-free reference to an auxiliary skill selected for a job.
 *
 * The runner must resolve the skill by `id` and reject it if either the
 * version or content hash no longer matches. Auxiliary skills are
 * materialized alongside the primary skill; they never replace `skillId` or
 * `skillName`.
 */
export interface AgentSelectedSkillReference {
  id: string;
  slug: string;
  version: number;
  contentHash: string;
}
