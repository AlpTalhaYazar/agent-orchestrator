import type {
  Subtask,
  WorkerResult,
  RepoContext,
  PlanOutput,
  RevisionOutput,
  OrchestratorRunResult,
} from "./types.js";
import type { OrchestratorTomlConfig } from "./config.js";
import { gatherContext } from "./context.js";
import { invokePlanner, invokePlannerRevision } from "./planner.js";
import { dispatchWorkers } from "./worker.js";

// =============================================================================
// CALLBACKS — enables UI hookup (Electron in Phase 2)
// =============================================================================

function workerResultToStatus(exitCode: number): Subtask["status"] {
  if (exitCode === -1) return "skipped";
  if (exitCode === 0) return "done";
  return "failed";
}

export interface LoopCallbacks {
  onContextGathered?: (context: RepoContext) => void;
  onPlanReady?: (plan: PlanOutput) => void;
  onWorkerStart?: (subtask: Subtask) => void;
  onWorkerComplete?: (result: WorkerResult) => void;
  onRevision?: (revision: RevisionOutput, round: number) => void;
  onComplete?: (result: OrchestratorRunResult) => void;
}

// =============================================================================
// ORCHESTRATE — the master iterative loop
// =============================================================================

/**
 * Run the full orchestration loop:
 * 1. Gather context (once)
 * 2. Invoke planner
 * 3. Dispatch workers
 * 4. Invoke planner for revision
 * 5. Repeat if planner says not done (up to max_rounds)
 */
export async function orchestrate(
  task: string,
  repoPath: string,
  config: OrchestratorTomlConfig,
  callbacks?: LoopCallbacks,
): Promise<OrchestratorRunResult> {
  const startTime = Date.now();

  // Step 1: Gather context (once for all rounds)
  const context = await gatherContext(repoPath, config.context);
  callbacks?.onContextGathered?.(context);

  // Step 2: Initial plan
  const plan = await invokePlanner(task, context, config);
  callbacks?.onPlanReady?.(plan);

  // Initialize subtasks with pending status
  const allSubtasks: Subtask[] = plan.subtasks.map((s) => ({
    ...s,
    status: "pending" as const,
  }));

  const allResults: WorkerResult[] = [];
  let finalSummary = plan.summary ?? "";
  let round = 0;

  // Step 3-5: Iterative loop
  while (round < config.planner.max_rounds) {
    round++;

    // Get pending subtasks for this round
    const pendingSubtasks = allSubtasks.filter((s) => s.status === "pending");
    if (pendingSubtasks.length === 0) break;

    // Fire onWorkerStart for each subtask about to be dispatched
    for (const subtask of pendingSubtasks) {
      callbacks?.onWorkerStart?.(subtask);
    }

    // Dispatch workers
    const roundResults = await dispatchWorkers(
      pendingSubtasks,
      config,
      repoPath,
    );

    // Update subtask statuses from results and fire callbacks
    for (const result of roundResults) {
      const subtask = allSubtasks.find((s) => s.id === result.subtaskId);
      if (subtask) {
        subtask.status = workerResultToStatus(result.exitCode);
        subtask.result = result;
      }
      callbacks?.onWorkerComplete?.(result);
    }

    allResults.push(...roundResults);

    // Check if we've hit max rounds — skip revision if so
    if (round >= config.planner.max_rounds) break;

    // Invoke planner for revision
    const revision = await invokePlannerRevision(
      task,
      allSubtasks,
      allResults,
      config,
    );
    callbacks?.onRevision?.(revision, round);

    finalSummary = revision.summary;

    if (revision.done) break;

    // Add follow-up subtasks
    for (const followUp of revision.followUpSubtasks) {
      allSubtasks.push({
        ...followUp,
        status: "pending" as const,
      });
    }
  }

  const result: OrchestratorRunResult = {
    task,
    rounds: round,
    finalSummary,
    subtasks: allSubtasks,
    totalDurationMs: Date.now() - startTime,
  };

  callbacks?.onComplete?.(result);
  return result;
}
