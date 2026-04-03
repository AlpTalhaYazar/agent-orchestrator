import { describe, it, expect, vi, beforeEach } from "vitest";
import { orchestrate, type LoopCallbacks } from "../loop.js";
import { getDefaultConfig, type OrchestratorTomlConfig } from "../config.js";
import type { PlanOutput, RevisionOutput, WorkerResult, Subtask, RepoContext } from "../types.js";

// Mock all dependencies
vi.mock("../context.js", () => ({
  gatherContext: vi.fn(),
}));

vi.mock("../planner.js", () => ({
  invokePlanner: vi.fn(),
  invokePlannerRevision: vi.fn(),
}));

vi.mock("../worker.js", () => ({
  dispatchWorkers: vi.fn(),
}));

const mockContext: RepoContext = {
  directoryTree: "src/\n  index.ts",
  configFiles: {},
  readme: null,
  claudeMd: null,
  gitLog: null,
};

function makeWorkerResult(subtaskId: string, exitCode: number = 0): WorkerResult {
  return {
    subtaskId,
    exitCode,
    stdout: `Output for ${subtaskId}`,
    stderr: "",
    durationMs: 1000,
    timedOut: false,
  };
}

describe("orchestrate", () => {
  let mockGatherContext: ReturnType<typeof vi.fn>;
  let mockInvokePlanner: ReturnType<typeof vi.fn>;
  let mockInvokePlannerRevision: ReturnType<typeof vi.fn>;
  let mockDispatchWorkers: ReturnType<typeof vi.fn>;
  let config: OrchestratorTomlConfig;

  beforeEach(async () => {
    vi.clearAllMocks();

    const contextMod = await import("../context.js");
    const plannerMod = await import("../planner.js");
    const workerMod = await import("../worker.js");

    mockGatherContext = vi.mocked(contextMod.gatherContext);
    mockInvokePlanner = vi.mocked(plannerMod.invokePlanner);
    mockInvokePlannerRevision = vi.mocked(plannerMod.invokePlannerRevision);
    mockDispatchWorkers = vi.mocked(workerMod.dispatchWorkers);

    config = getDefaultConfig();
    mockGatherContext.mockResolvedValue(mockContext);
  });

  it("completes single-round orchestration", async () => {
    const plan: PlanOutput = {
      subtasks: [
        { id: "1", description: "Create API", dependencies: [] },
        { id: "2", description: "Add tests", dependencies: ["1"] },
      ],
      summary: "Two-step plan",
    };
    mockInvokePlanner.mockResolvedValue(plan);
    mockDispatchWorkers.mockResolvedValue([
      makeWorkerResult("1"),
      makeWorkerResult("2"),
    ]);
    const revision: RevisionOutput = {
      done: true,
      summary: "All completed",
      followUpSubtasks: [],
    };
    mockInvokePlannerRevision.mockResolvedValue(revision);

    const result = await orchestrate("Build feature", "/repo", config);

    expect(result.task).toBe("Build feature");
    expect(result.rounds).toBe(1);
    expect(result.finalSummary).toBe("All completed");
    expect(result.subtasks).toHaveLength(2);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(mockGatherContext).toHaveBeenCalledOnce();
    expect(mockInvokePlanner).toHaveBeenCalledOnce();
    expect(mockDispatchWorkers).toHaveBeenCalledOnce();
    expect(mockInvokePlannerRevision).toHaveBeenCalledOnce();
  });

  it("handles multi-round orchestration with follow-ups", async () => {
    const plan: PlanOutput = {
      subtasks: [{ id: "1", description: "Backend", dependencies: [] }],
      summary: "Start with backend",
    };
    mockInvokePlanner.mockResolvedValue(plan);

    // Round 1: worker completes, planner says not done
    mockDispatchWorkers.mockResolvedValueOnce([makeWorkerResult("1")]);
    mockInvokePlannerRevision.mockResolvedValueOnce({
      done: false,
      summary: "Need frontend",
      followUpSubtasks: [{ id: "2", description: "Frontend", dependencies: [] }],
    });

    // Round 2: follow-up completes, planner says done
    mockDispatchWorkers.mockResolvedValueOnce([makeWorkerResult("2")]);
    mockInvokePlannerRevision.mockResolvedValueOnce({
      done: true,
      summary: "All done",
      followUpSubtasks: [],
    });

    const result = await orchestrate("Full stack", "/repo", config);

    expect(result.rounds).toBe(2);
    expect(result.finalSummary).toBe("All done");
    expect(result.subtasks).toHaveLength(2);
    expect(mockDispatchWorkers).toHaveBeenCalledTimes(2);
    expect(mockInvokePlannerRevision).toHaveBeenCalledTimes(2);
    // Context gathered only once
    expect(mockGatherContext).toHaveBeenCalledOnce();
  });

  it("respects max_rounds limit", async () => {
    config = { ...config, planner: { ...config.planner, max_rounds: 2 } };

    const plan: PlanOutput = {
      subtasks: [{ id: "1", description: "Task", dependencies: [] }],
    };
    mockInvokePlanner.mockResolvedValue(plan);

    // Round 1: planner says not done
    mockDispatchWorkers.mockResolvedValueOnce([makeWorkerResult("1")]);
    mockInvokePlannerRevision.mockResolvedValueOnce({
      done: false,
      summary: "More work needed",
      followUpSubtasks: [{ id: "2", description: "More work", dependencies: [] }],
    });

    // Round 2: hits max_rounds, no revision call
    mockDispatchWorkers.mockResolvedValueOnce([makeWorkerResult("2")]);

    const result = await orchestrate("task", "/repo", config);

    expect(result.rounds).toBe(2);
    // Only 1 revision call (round 2 skips revision because max_rounds reached)
    expect(mockInvokePlannerRevision).toHaveBeenCalledTimes(1);
  });

  it("fires callbacks in correct order", async () => {
    const plan: PlanOutput = {
      subtasks: [{ id: "1", description: "Task", dependencies: [] }],
    };
    mockInvokePlanner.mockResolvedValue(plan);
    mockDispatchWorkers.mockResolvedValue([makeWorkerResult("1")]);
    mockInvokePlannerRevision.mockResolvedValue({
      done: true,
      summary: "Done",
      followUpSubtasks: [],
    });

    const callOrder: string[] = [];
    const callbacks: LoopCallbacks = {
      onContextGathered: () => callOrder.push("context"),
      onPlanReady: () => callOrder.push("plan"),
      onWorkerComplete: () => callOrder.push("worker"),
      onRevision: () => callOrder.push("revision"),
      onComplete: () => callOrder.push("complete"),
    };

    await orchestrate("task", "/repo", config, callbacks);

    expect(callOrder).toEqual([
      "context",
      "plan",
      "worker",
      "revision",
      "complete",
    ]);
  });

  it("handles worker failure gracefully", async () => {
    const plan: PlanOutput = {
      subtasks: [
        { id: "1", description: "Failing task", dependencies: [] },
      ],
    };
    mockInvokePlanner.mockResolvedValue(plan);
    mockDispatchWorkers.mockResolvedValue([
      { ...makeWorkerResult("1"), exitCode: 1, stderr: "error" },
    ]);
    mockInvokePlannerRevision.mockResolvedValue({
      done: true,
      summary: "Task failed, stopping",
      followUpSubtasks: [],
    });

    const result = await orchestrate("task", "/repo", config);
    expect(result.rounds).toBe(1);
    expect(result.finalSummary).toBe("Task failed, stopping");
  });

  it("stops when no pending subtasks remain", async () => {
    const plan: PlanOutput = {
      subtasks: [{ id: "1", description: "Only task", dependencies: [] }],
    };
    mockInvokePlanner.mockResolvedValue(plan);
    mockDispatchWorkers.mockResolvedValue([makeWorkerResult("1")]);
    mockInvokePlannerRevision.mockResolvedValue({
      done: false,
      summary: "Not done but no follow-ups",
      followUpSubtasks: [], // No new tasks
    });

    const result = await orchestrate("task", "/repo", config);

    // Second iteration finds no pending subtasks and breaks
    expect(result.rounds).toBe(2);
    expect(mockDispatchWorkers).toHaveBeenCalledTimes(1);
  });

  it("uses plan summary when revision never runs", async () => {
    config = { ...config, planner: { ...config.planner, max_rounds: 1 } };

    const plan: PlanOutput = {
      subtasks: [{ id: "1", description: "Task", dependencies: [] }],
      summary: "Plan summary",
    };
    mockInvokePlanner.mockResolvedValue(plan);
    mockDispatchWorkers.mockResolvedValue([makeWorkerResult("1")]);

    const result = await orchestrate("task", "/repo", config);

    expect(result.finalSummary).toBe("Plan summary");
    expect(mockInvokePlannerRevision).not.toHaveBeenCalled();
  });
});
