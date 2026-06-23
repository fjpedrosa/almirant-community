/**
 * Dependency graph (DAG) for agent job scheduling.
 *
 * Pure functional module -- no classes, no side-effects, no I/O.
 * All functions operate on plain data structures.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal job representation needed to build the graph. */
export interface JobNode {
  /** Agent job id. */
  jobId: string;
  /** The work item this job belongs to (may be null for orphan jobs). */
  workItemId: string | null;
}

/**
 * A dependency edge: `jobId` is blocked by `blockedByJobId`.
 * Both reference *job* ids (not work-item ids).
 */
export interface JobDependencyEdge {
  jobId: string;
  blockedByJobId: string;
}

/**
 * Adjacency-list representation of the DAG.
 *
 * - `nodes`       Set of all job ids in the graph.
 * - `dependsOn`   jobId -> Set of job ids it depends on (predecessors).
 * - `dependents`  jobId -> Set of job ids that depend on it (successors).
 */
export interface DependencyGraph {
  nodes: Set<string>;
  dependsOn: Map<string, Set<string>>;
  dependents: Map<string, Set<string>>;
}

/** Result of cycle detection -- either null (no cycles) or an array of cycle paths. */
export type CycleDetectionResult = string[][] | null;

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/**
 * Build a dependency graph from a list of jobs and their dependency edges.
 *
 * @param jobs  All jobs to include in the graph.
 * @param edges Dependency edges between jobs (jobId blocked by blockedByJobId).
 *              Edges referencing job ids NOT in `jobs` are silently ignored.
 */
export const buildDependencyGraph = (
  jobs: JobNode[],
  edges: JobDependencyEdge[],
): DependencyGraph => {
  const nodes = new Set(jobs.map((j) => j.jobId));
  const dependsOn = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();

  // Initialise empty sets for every node.
  for (const id of nodes) {
    dependsOn.set(id, new Set());
    dependents.set(id, new Set());
  }

  // Populate edges (only if both ends are in the graph).
  for (const edge of edges) {
    if (!nodes.has(edge.jobId) || !nodes.has(edge.blockedByJobId)) continue;
    // Self-loops are ignored to prevent trivial deadlocks.
    if (edge.jobId === edge.blockedByJobId) continue;

    dependsOn.get(edge.jobId)!.add(edge.blockedByJobId);
    dependents.get(edge.blockedByJobId)!.add(edge.jobId);
  }

  return { nodes, dependsOn, dependents };
};

// ---------------------------------------------------------------------------
// Executable jobs
// ---------------------------------------------------------------------------

/**
 * Return the set of job ids that are ready to execute.
 *
 * A job is executable when **all** of its dependencies are in `completedIds`.
 * Jobs that are themselves already completed are excluded.
 *
 * @param graph        The dependency graph.
 * @param completedIds Set of job ids that have already completed.
 * @param excludeIds   Optional set of job ids to exclude (e.g. currently running).
 */
export const getExecutableJobs = (
  graph: DependencyGraph,
  completedIds: Set<string>,
  excludeIds?: Set<string>,
): string[] => {
  const executable: string[] = [];

  for (const jobId of graph.nodes) {
    // Skip already-completed or explicitly excluded jobs.
    if (completedIds.has(jobId)) continue;
    if (excludeIds?.has(jobId)) continue;

    const deps = graph.dependsOn.get(jobId);
    if (!deps || deps.size === 0) {
      // No dependencies -- immediately executable.
      executable.push(jobId);
      continue;
    }

    // All dependencies must be completed.
    let allMet = true;
    for (const depId of deps) {
      if (!completedIds.has(depId)) {
        allMet = false;
        break;
      }
    }
    if (allMet) executable.push(jobId);
  }

  return executable;
};

// ---------------------------------------------------------------------------
// Cycle detection (DFS-based)
// ---------------------------------------------------------------------------

/**
 * Detect cycles in the dependency graph.
 *
 * Uses iterative DFS with three-color marking:
 *   WHITE (unvisited), GRAY (in current path), BLACK (fully processed).
 *
 * @returns `null` if the graph is acyclic, or an array of cycle paths
 *          (each cycle is an array of job ids forming the loop).
 */
export const detectCycles = (graph: DependencyGraph): CycleDetectionResult => {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  for (const id of graph.nodes) color.set(id, WHITE);

  // parent map to reconstruct cycle paths
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  const extractCycle = (start: string, end: string): string[] => {
    const path: string[] = [start];
    let current = end;
    while (current !== start) {
      path.push(current);
      current = parent.get(current) ?? start; // safety fallback
    }
    path.push(start);
    path.reverse();
    return path;
  };

  // Iterative DFS using an explicit stack.
  for (const startNode of graph.nodes) {
    if (color.get(startNode) !== WHITE) continue;

    // Stack entries: [nodeId, iterator-of-neighbours, isEntering]
    type StackFrame = { node: string; neighbours: string[]; idx: number };
    const stack: StackFrame[] = [];

    color.set(startNode, GRAY);
    parent.set(startNode, null);
    stack.push({
      node: startNode,
      neighbours: [...(graph.dependsOn.get(startNode) ?? [])],
      idx: 0,
    });

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;

      if (frame.idx >= frame.neighbours.length) {
        // All neighbours processed -- mark BLACK and pop.
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }

      const neighbour = frame.neighbours[frame.idx]!;
      frame.idx++;

      const neighbourColor = color.get(neighbour);
      if (neighbourColor === GRAY) {
        // Back-edge detected -- cycle found.
        cycles.push(extractCycle(neighbour, frame.node));
      } else if (neighbourColor === WHITE) {
        color.set(neighbour, GRAY);
        parent.set(neighbour, frame.node);
        stack.push({
          node: neighbour,
          neighbours: [...(graph.dependsOn.get(neighbour) ?? [])],
          idx: 0,
        });
      }
      // BLACK neighbours are already fully explored -- skip.
    }
  }

  return cycles.length > 0 ? cycles : null;
};

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

/**
 * Topological sort of the dependency graph using Kahn's algorithm.
 *
 * @returns An array of job ids in dependency order (a job appears only after
 *          all of its dependencies). If the graph has cycles the returned
 *          array will be shorter than the number of nodes -- callers should
 *          use `detectCycles` first to validate.
 */
export const topologicalSort = (graph: DependencyGraph): string[] => {
  // In-degree: number of dependencies for each node.
  const inDegree = new Map<string, number>();
  for (const id of graph.nodes) {
    inDegree.set(id, (graph.dependsOn.get(id) ?? new Set()).size);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const dependent of graph.dependents.get(current) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  return sorted;
};
