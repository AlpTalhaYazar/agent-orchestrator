import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildPlannerPrompt,
  buildRevisionPrompt,
  extractJsonFromOutput,
  invokeCliAgent,
  invokePlanner,
  invokePlannerRevision,
} from "../planner.js";
import type { RepoContext, Subtask, WorkerResult } from "../types.js";
import { getDefaultConfig } from "../config.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdtemp: vi.fn().mockResolvedValue("/tmp/ao-planner-mock"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

const mockContext: RepoContext = {
  directoryTree: "src/\n  index.ts\npackage.json",
  configFiles: { "package.json": '{"name":"test"}' },
  readme: "# Test Project",
  claudeMd: null,
  gitLog: "abc1234 feat: initial commit",
};

const emptyContext: RepoContext = {
  directoryTree: "",
  configFiles: {},
  readme: null,
  claudeMd: null,
  gitLog: null,
};

describe("buildPlannerPrompt", () => {
  it("includes task and context sections", () => {
    const prompt = buildPlannerPrompt("Add auth", mockContext);
    expect(prompt).toContain("Add auth");
    expect(prompt).toContain("Directory Structure");
    expect(prompt).toContain("src/");
    expect(prompt).toContain("package.json");
    expect(prompt).toContain("# Test Project");
    expect(prompt).toContain("abc1234");
    expect(prompt).toContain("Output Format");
  });

  it("omits null context sections", () => {
    const prompt = buildPlannerPrompt("task", emptyContext);
    expect(prompt).toContain("task");
    expect(prompt).not.toContain("Directory Structure");
    expect(prompt).not.toContain("README");
    expect(prompt).not.toContain("CLAUDE.md");
    expect(prompt).not.toContain("Git History");
  });

  it("includes CLAUDE.md when present", () => {
    const ctx: RepoContext = {
      ...emptyContext,
      claudeMd: "# CLAUDE Instructions",
    };
    const prompt = buildPlannerPrompt("task", ctx);
    expect(prompt).toContain("CLAUDE.md");
    expect(prompt).toContain("# CLAUDE Instructions");
  });
});

describe("buildRevisionPrompt", () => {
  it("includes all worker results", () => {
    const subtasks: Subtask[] = [
      { id: "1", description: "Backend API", dependencies: [], status: "done" },
      { id: "2", description: "Frontend UI", dependencies: ["1"], status: "failed" },
    ];
    const results: WorkerResult[] = [
      {
        subtaskId: "1",
        exitCode: 0,
        stdout: "API routes created",
        stderr: "",
        durationMs: 5000,
        timedOut: false,
      },
      {
        subtaskId: "2",
        exitCode: 1,
        stdout: "",
        stderr: "Component error",
        durationMs: 3000,
        timedOut: false,
      },
    ];
    const prompt = buildRevisionPrompt("Build feature", subtasks, results);
    expect(prompt).toContain("Build feature");
    expect(prompt).toContain("Backend API");
    expect(prompt).toContain("Frontend UI");
    expect(prompt).toContain("API routes created");
    expect(prompt).toContain("Component error");
    expect(prompt).toContain("Exit code: 0");
    expect(prompt).toContain("Exit code: 1");
  });

  it("marks timed out workers", () => {
    const subtasks: Subtask[] = [
      { id: "1", description: "Slow task", dependencies: [], status: "failed" },
    ];
    const results: WorkerResult[] = [
      {
        subtaskId: "1",
        exitCode: 137,
        stdout: "partial",
        stderr: "",
        durationMs: 60000,
        timedOut: true,
      },
    ];
    const prompt = buildRevisionPrompt("task", subtasks, results);
    expect(prompt).toContain("TIMED OUT");
  });
});

describe("extractJsonFromOutput", () => {
  it("parses raw JSON string", () => {
    const result = extractJsonFromOutput(
      '{"subtasks": [{"id": "1", "description": "test"}]}',
    );
    expect(result).toEqual({
      subtasks: [{ id: "1", description: "test" }],
    });
  });

  it("extracts from markdown code fence", () => {
    const output = `Here is the plan:

\`\`\`json
{"subtasks": [{"id": "1", "description": "test"}]}
\`\`\`

That's my plan.`;
    const result = extractJsonFromOutput(output);
    expect(result).toEqual({
      subtasks: [{ id: "1", description: "test" }],
    });
  });

  it("extracts from text with surrounding prose", () => {
    const output = `I'll create a plan for you.

{"subtasks": [{"id": "1", "description": "test"}], "summary": "plan"}

Let me know if this works.`;
    const result = extractJsonFromOutput(output);
    expect(result).toEqual({
      subtasks: [{ id: "1", description: "test" }],
      summary: "plan",
    });
  });

  it("handles JSON with whitespace", () => {
    const output = `
    {
      "subtasks": [
        { "id": "1", "description": "test" }
      ]
    }
    `;
    const result = extractJsonFromOutput(output);
    expect(result).toEqual({
      subtasks: [{ id: "1", description: "test" }],
    });
  });

  it("throws on no JSON found", () => {
    expect(() => extractJsonFromOutput("This is just plain text")).toThrow(
      /Could not extract JSON/,
    );
  });

  it("throws on empty input", () => {
    expect(() => extractJsonFromOutput("")).toThrow(/Could not extract JSON/);
  });
});

describe("invokeCliAgent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls CLI with correct args for short prompts", async () => {
    const { execFile } = await import("node:child_process");
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: readonly string[], _opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
        // execFile with promisify expects callback-style
        if (callback) {
          callback(null, { stdout: '{"result": "ok"}', stderr: "" });
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile,
    );

    const result = await invokeCliAgent("claude", "short prompt", "sonnet");
    expect(result).toBe('{"result": "ok"}');
    expect(mockExecFile).toHaveBeenCalledWith(
      "claude",
      ["--print", "-p", "short prompt", "--model", "sonnet"],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe("invokePlanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("validates output against PlanOutputSchema", async () => {
    const { execFile } = await import("node:child_process");
    const mockExecFile = vi.mocked(execFile);
    const validPlan = JSON.stringify({
      subtasks: [
        { id: "1", description: "Create API", dependencies: [] },
        { id: "2", description: "Add tests", dependencies: ["1"] },
      ],
      summary: "Two-step plan",
    });
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: readonly string[], _opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
        if (callback) {
          callback(null, { stdout: validPlan, stderr: "" });
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile,
    );

    const config = getDefaultConfig();
    const result = await invokePlanner("Build API", mockContext, config);
    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks[0].id).toBe("1");
    expect(result.subtasks[1].dependencies).toEqual(["1"]);
    expect(result.summary).toBe("Two-step plan");
  });

  it("throws on invalid plan JSON", async () => {
    const { execFile } = await import("node:child_process");
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: readonly string[], _opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
        if (callback) {
          callback(null, {
            stdout: '{"subtasks": []}', // min 1 subtask required
            stderr: "",
          });
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile,
    );

    const config = getDefaultConfig();
    await expect(
      invokePlanner("task", mockContext, config),
    ).rejects.toThrow();
  });
});

describe("invokePlannerRevision", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns RevisionOutput with done: true", async () => {
    const { execFile } = await import("node:child_process");
    const mockExecFile = vi.mocked(execFile);
    const validRevision = JSON.stringify({
      done: true,
      summary: "All tasks completed",
      followUpSubtasks: [],
    });
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: readonly string[], _opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
        if (callback) {
          callback(null, { stdout: validRevision, stderr: "" });
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile,
    );

    const config = getDefaultConfig();
    const subtasks: Subtask[] = [
      { id: "1", description: "test", dependencies: [], status: "done" },
    ];
    const results: WorkerResult[] = [
      {
        subtaskId: "1",
        exitCode: 0,
        stdout: "done",
        stderr: "",
        durationMs: 1000,
        timedOut: false,
      },
    ];
    const result = await invokePlannerRevision(
      "task",
      subtasks,
      results,
      config,
    );
    expect(result.done).toBe(true);
    expect(result.summary).toBe("All tasks completed");
    expect(result.followUpSubtasks).toEqual([]);
  });
});
