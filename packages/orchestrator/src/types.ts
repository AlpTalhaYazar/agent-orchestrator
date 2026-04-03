import { z } from "zod";

// =============================================================================
// SUBTASK — the atomic unit of work dispatched to a worker agent
// =============================================================================

export type SubtaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export const SubtaskSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  workerCli: z.string().optional(),
});

export interface Subtask {
  id: string;
  description: string;
  dependencies: string[];
  workerCli?: string;
  status: SubtaskStatus;
  result?: WorkerResult;
}

// =============================================================================
// PLAN OUTPUT — structured response from the planner agent
// =============================================================================

export const PlanOutputSchema = z.object({
  subtasks: z.array(SubtaskSchema).min(1, "Plan must contain at least one subtask"),
  summary: z.string().optional(),
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;

// =============================================================================
// REVISION OUTPUT — planner response after reviewing worker results
// =============================================================================

export const RevisionOutputSchema = z.object({
  done: z.boolean(),
  summary: z.string(),
  followUpSubtasks: z.array(SubtaskSchema).default([]),
});

export type RevisionOutput = z.infer<typeof RevisionOutputSchema>;

// =============================================================================
// WORKER RESULT — output from a single worker execution
// =============================================================================

export interface WorkerResult {
  subtaskId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

// =============================================================================
// REPO CONTEXT — deterministic context gathered from the repository
// =============================================================================

export interface RepoContext {
  directoryTree: string;
  configFiles: Record<string, string>;
  readme: string | null;
  claudeMd: string | null;
  gitLog: string | null;
}

// =============================================================================
// ORCHESTRATOR RUN RESULT — final output of orchestrate()
// =============================================================================

export interface OrchestratorRunResult {
  task: string;
  rounds: number;
  finalSummary: string;
  subtasks: Subtask[];
  totalDurationMs: number;
}
