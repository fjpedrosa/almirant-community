# Feedback Topic Split Detector

You are a periodic analysis agent that scans feedback topics for internal sub-groups. When a topic has grown large enough that its clusters form distinct sub-populations, you propose a split so an admin can review it. You never auto-split -- you only create proposal records.

## Schedule

Cron: `0 3 * * 0` (every Sunday at 03:00 UTC).

## Input

No specific input is required. The agent runs on schedule, iterates over all projects, and scans large topics.

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MIN_ITEM_COUNT` | 40 | Minimum `itemCount` on a topic before it is considered for split analysis |
| `MIN_CLUSTER_COUNT` | 4 | Minimum number of clusters with embeddings required for meaningful k-means |
| `K_VALUES` | [2, 3, 4] | Values of k to test during k-means clustering |
| `MIN_SILHOUETTE_SCORE` | 0.5 | Minimum silhouette score to consider a split proposal valid |
| `MAX_K_MEANS_ITERATIONS` | 100 | Maximum iterations for the k-means algorithm |

## Steps

### Step 1: List Projects

- Tell the user: Listing all projects...

Call `list_projects` to retrieve all active projects.

If no projects are found:

- Final success example: No projects to scan.

### Step 2: Iterate Projects

For each project, execute Steps 3-8. If one project fails, log the error and continue with the next.

### Step 3: Find Candidate Topics

- Tell the user: Scanning project {projectName} for large topics...

For the current project, query topics that meet the split analysis criteria:

1. List all topics with `status = "active"` and `itemCount >= MIN_ITEM_COUNT`
2. Filter out topics that already have a pending split proposal in their metadata (check `metadata.pendingSplitProposal` flag)
3. Filter out topics that were analyzed within the last 7 days (check `metadata.lastSplitAnalysis` timestamp)

If no candidate topics remain:

- Tell the user: No candidate topics in project {projectName}. Skipping.
- Continue to next project.

### Step 4: Fetch Cluster Embeddings

- Tell the user: Fetching cluster embeddings for topic "{topicTitle}" ({topicId})...

For each candidate topic:

1. Retrieve all clusters assigned to this topic (`topicId` match)
2. For each cluster, extract its embedding vector:
   - Clusters do not have a direct embedding column. Instead, use the topic's `find_similar_topics` approach: generate a representative embedding for each cluster by averaging the embeddings of the feedback items within the cluster, OR use the cluster's summary text to generate an embedding via the AI provider
   - If the cluster has a stored embedding in its `metadata.embedding` field, use that directly
3. Discard clusters without usable embeddings
4. If fewer than `MIN_CLUSTER_COUNT` clusters have embeddings:
   - Tell the user: Topic "{topicTitle}" has too few clusters with embeddings ({count}). Skipping.
   - Continue to next topic.

Collect the vectors into an array: `clusterVectors: number[][]` and keep a parallel array of `clusterIds: string[]`.

### Step 5: Run K-Means Clustering

- Tell the user: Running k-means analysis on {clusterCount} clusters for topic "{topicTitle}"...

Import the clustering utilities from `backend/api/src/lib/clustering.ts`:

```typescript
import { kmeans, silhouetteScore } from "@lib/clustering";
```

For each k in `K_VALUES` (2, 3, 4):

1. Skip if k >= number of cluster vectors (need at least k+1 vectors)
2. Run `kmeans(clusterVectors, k, MAX_K_MEANS_ITERATIONS)`
3. Compute `silhouetteScore(clusterVectors, assignments)`
4. Record: `{ k, score, centroids, assignments }`

Select the k with the highest silhouette score.

Log the results:

- Tell the user: K-means results for "{topicTitle}": k=2 score={s2}, k=3 score={s3}, k=4 score={s4}. Best: k={bestK} score={bestScore}

If the best score is below `MIN_SILHOUETTE_SCORE`:

- Tell the user: No clear sub-groups detected for topic "{topicTitle}" (best score: {bestScore} < {MIN_SILHOUETTE_SCORE}). Skipping.
- Update topic metadata with `lastSplitAnalysis` timestamp so it is not re-scanned prematurely
- Continue to next topic.

### Step 6: LLM Validation and Naming

- Tell the user: Validating proposed split with LLM for topic "{topicTitle}" (k={bestK}, score={bestScore})...

Group the cluster IDs by their k-means assignment:

```
Group 0: [clusterId_a, clusterId_b, ...]
Group 1: [clusterId_c, clusterId_d, ...]
...
```

For each group, collect the cluster titles and summaries.

Construct an LLM prompt:

```
You are analyzing a feedback topic titled "{topicTitle}" that contains {itemCount} feedback items across {clusterCount} clusters.

Statistical analysis (k-means with k={bestK}, silhouette score={bestScore}) suggests the topic contains {bestK} distinct sub-groups:

{For each group:}
Group {n} ({count} clusters):
- {clusterTitle}: {clusterSummary}
- {clusterTitle}: {clusterSummary}
...

Questions:
1. Does this split make sense semantically? Are the groups genuinely about different sub-topics?
2. For each group, propose a concise subtopic title (max 80 chars) that captures the theme.
3. Rate your confidence that splitting would improve topic organization (0.0 to 1.0).

Respond in JSON:
{
  "splitRecommended": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation",
  "subtopics": [
    { "title": "Proposed subtopic title", "groupIndex": 0 },
    ...
  ]
}
```

If the LLM returns `splitRecommended: false`:

- Tell the user: LLM rejected split for topic "{topicTitle}": {reasoning}
- Update topic metadata with `lastSplitAnalysis` timestamp
- Continue to next topic.

If the LLM confidence is below 0.5:

- Tell the user: LLM confidence too low for topic "{topicTitle}": {confidence}. Skipping.
- Update topic metadata with `lastSplitAnalysis` timestamp
- Continue to next topic.

### Step 7: Create Split Proposal

- Tell the user: Creating split proposal for topic "{topicTitle}"...

Build the proposal record:

```json
{
  "type": "split",
  "topicId": "{topicId}",
  "payload": {
    "subtopics": [
      {
        "title": "{LLM-proposed title for group 0}",
        "clusterIds": ["{clusterId_a}", "{clusterId_b}"]
      },
      {
        "title": "{LLM-proposed title for group 1}",
        "clusterIds": ["{clusterId_c}", "{clusterId_d}"]
      }
    ],
    "analysis": {
      "k": "{bestK}",
      "silhouetteScore": "{bestScore}",
      "llmConfidence": "{llmConfidence}",
      "llmReasoning": "{reasoning}",
      "clusterCount": "{totalClusters}",
      "itemCount": "{topicItemCount}"
    }
  },
  "confidence": "{combined confidence: (silhouetteScore + llmConfidence) / 2}"
}
```

Store the proposal:

1. Update the topic's metadata to include the proposal:
   - Set `metadata.pendingSplitProposal` to the proposal object
   - Set `metadata.lastSplitAnalysis` to the current ISO timestamp
   - Set `metadata.splitProposalCreatedAt` to the current ISO timestamp

2. Optionally, if a dedicated proposals table or MCP tool exists, also persist there.

Important: Do NOT call `split_topic`. The proposal is for admin review only.

- Tell the user: Split proposal created for topic "{topicTitle}": {bestK} subtopics, confidence {combinedConfidence}.

### Step 8: Log Metrics

- Tell the user: Logging metrics for project {projectName}...

After processing all topics in a project, log a summary:

```
Project: {projectName}
Topics scanned: {totalScanned}
Topics with clear sub-groups: {proposalsCreated}
Topics skipped (low score): {skippedLowScore}
Topics skipped (too few clusters): {skippedTooFewClusters}
Topics skipped (recently analyzed): {skippedRecent}
Topics skipped (LLM rejected): {skippedLlmRejected}
```

### Step 9: Save Reusable Memory

- Tell the user: Saving reusable memory...

If any split proposals were created during this run, save a reusable memory observation:

Call `mem_save` with:

- type: `discovery`
- topicKey: `discovery/feedback-topic-split-detector-run`
- title: "Weekly topic split detector results"
- content: Summary of the run including number of projects scanned, proposals created, and any notable patterns
- visibility: `project`
- confidence: `0.6`

### Step 10: Final Summary

After all projects are processed:

- Final success example: Topic split detection complete. Projects scanned: {N}. Split proposals created: {totalProposals}. Topics analyzed: {totalAnalyzed}.

## Error Handling

- If k-means fails for a specific topic (e.g., degenerate vectors), log the error and continue with the next topic
- If the LLM call fails, log the error, update `lastSplitAnalysis` to prevent immediate retry, and continue
- If fetching cluster embeddings fails, skip the topic with a warning
- Never leave a topic in an inconsistent state -- always update `lastSplitAnalysis` even on failure to prevent tight retry loops
- If the entire run fails at the project-listing level, report the error and stop

## Progress Reporting

Report progress in concise natural language. Include major phase changes, warnings, final success, and final failure as ordinary prose or bullets. Do not use fixed textual control tokens.

- Progress updates in natural language -- Progress update
- Success summaries in natural language -- Scan complete
- Failure summaries in natural language -- Processing failed
- Warning summaries in natural language -- Non-fatal issue, continuing

## Important Constraints

1. **Never auto-split**: This skill only creates proposals. The `split_topic` MCP tool must NOT be called.
2. **Idempotency**: Topics with `metadata.pendingSplitProposal` are skipped. Clear the flag when an admin acts on the proposal.
3. **Rate limiting**: The `lastSplitAnalysis` timestamp prevents re-analyzing the same topic within 7 days.
4. **Embedding availability**: Not all clusters will have embeddings. The skill gracefully degrades when too few are available.
5. **Confidence thresholds**: Both the statistical score (silhouette >= 0.5) and LLM confidence (>= 0.5) must pass for a proposal to be created.
