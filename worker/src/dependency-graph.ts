/**
 * DAG-based dependency graph for parallel job execution.
 * All pure functions, no side effects.
 */

type JobId = string;
type AdjacencyMap = Map<JobId, Set<JobId>>; // job -> set of jobs it depends on

export interface ExecutionPlan {
  layers: JobId[][]; // each layer can execute in parallel
  hasCycles: boolean;
}

/**
 * Build adjacency map from job dependency data.
 * Input: array of { jobId, dependsOn: jobId[] }
 * Returns a map where each job points to the set of jobs it depends on.
 */
export const buildDependencyGraph = (
  jobs: Array<{ jobId: string; dependsOn: string[] }>
): AdjacencyMap => {
  const graph: AdjacencyMap = new Map();

  // Initialize all jobs in the graph (even those with no dependencies)
  for (const job of jobs) {
    if (!graph.has(job.jobId)) {
      graph.set(job.jobId, new Set());
    }
    for (const dep of job.dependsOn) {
      graph.get(job.jobId)!.add(dep);
      // Ensure the dependency also exists in the graph
      if (!graph.has(dep)) {
        graph.set(dep, new Set());
      }
    }
  }

  return graph;
};

/**
 * Detect cycles using DFS. Returns true if cycles exist.
 * Uses three-color marking: white (unvisited), gray (in current stack), black (fully processed).
 */
export const detectCycles = (graph: AdjacencyMap): boolean => {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<JobId, number>();
  for (const jobId of graph.keys()) {
    color.set(jobId, WHITE);
  }

  const dfs = (node: JobId): boolean => {
    color.set(node, GRAY);

    const dependencies = graph.get(node) ?? new Set();
    for (const dep of dependencies) {
      const depColor = color.get(dep) ?? WHITE;
      if (depColor === GRAY) {
        // Back edge found — cycle detected
        return true;
      }
      if (depColor === WHITE && dfs(dep)) {
        return true;
      }
    }

    color.set(node, BLACK);
    return false;
  };

  for (const jobId of graph.keys()) {
    if ((color.get(jobId) ?? WHITE) === WHITE) {
      if (dfs(jobId)) return true;
    }
  }

  return false;
};

/**
 * Generate execution plan using Kahn's algorithm (topological sort).
 * Returns parallel layers: jobs in the same layer have no interdependencies
 * and can all be executed concurrently.
 *
 * Layer 0: jobs with no dependencies (roots)
 * Layer 1: jobs whose dependencies are all in layer 0
 * Layer N: jobs whose dependencies are all in layers 0..N-1
 */
export const getExecutionPlan = (graph: AdjacencyMap): ExecutionPlan => {
  const hasCyclesResult = detectCycles(graph);

  if (hasCyclesResult) {
    // With cycles, we can't produce a valid topological ordering.
    // Return all jobs in a single layer as a fallback.
    return {
      layers: [Array.from(graph.keys())],
      hasCycles: true,
    };
  }

  // Compute in-degree for each node
  // In-degree = number of dependencies that haven't been processed yet
  const inDegree = new Map<JobId, number>();
  for (const jobId of graph.keys()) {
    inDegree.set(jobId, 0);
  }

  // Build reverse adjacency: for each dependency, track who depends on it
  const reverseDeps = new Map<JobId, Set<JobId>>();
  for (const [jobId, deps] of graph) {
    for (const dep of deps) {
      if (!reverseDeps.has(dep)) {
        reverseDeps.set(dep, new Set());
      }
      reverseDeps.get(dep)!.add(jobId);
      // Increment in-degree of the job that depends on dep
      inDegree.set(jobId, (inDegree.get(jobId) ?? 0) + 1);
    }
  }

  const layers: JobId[][] = [];
  const processed = new Set<JobId>();

  // Start with all zero in-degree nodes
  let currentLayer = Array.from(graph.keys()).filter(
    (id) => (inDegree.get(id) ?? 0) === 0
  );

  while (currentLayer.length > 0) {
    layers.push([...currentLayer]);

    const nextLayer: JobId[] = [];

    for (const jobId of currentLayer) {
      processed.add(jobId);

      // For each job that depends on this one, decrement its in-degree
      const dependents = reverseDeps.get(jobId) ?? new Set();
      for (const dependent of dependents) {
        if (processed.has(dependent)) continue;
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          nextLayer.push(dependent);
        }
      }
    }

    currentLayer = nextLayer;
  }

  return { layers, hasCycles: false };
};

/**
 * Given current completed jobs, return which jobs are now executable.
 * A job is executable if all its dependencies are in the completed set.
 */
export const getExecutableJobs = (
  graph: AdjacencyMap,
  completedJobs: Set<JobId>
): JobId[] => {
  const executable: JobId[] = [];

  for (const [jobId, dependencies] of graph) {
    // Skip already completed jobs
    if (completedJobs.has(jobId)) continue;

    // Check if all dependencies are completed
    let allDepsCompleted = true;
    for (const dep of dependencies) {
      if (!completedJobs.has(dep)) {
        allDepsCompleted = false;
        break;
      }
    }

    if (allDepsCompleted) {
      executable.push(jobId);
    }
  }

  return executable;
};
