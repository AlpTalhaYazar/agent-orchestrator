import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { GlobalConfig, SessionManager } from "@composio/ao-core";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockLoadGlobalConfig,
  mockSaveGlobalConfig,
  mockUnregisterProject,
  mockDeleteShadowFile,
  mockLoadConfig,
  mockSessionManager,
  mockStopLifecycleWorker,
  mockPromptConfirm,
  mockIsHumanCaller,
} = vi.hoisted(() => ({
  mockLoadGlobalConfig: vi.fn(),
  mockSaveGlobalConfig: vi.fn(),
  mockUnregisterProject: vi.fn(),
  mockDeleteShadowFile: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockSessionManager: {
    list: vi.fn().mockResolvedValue([]),
    kill: vi.fn(),
    cleanup: vi.fn(),
    get: vi.fn(),
    spawn: vi.fn(),
    spawnOrchestrator: vi.fn(),
    send: vi.fn(),
    claimPR: vi.fn(),
  },
  mockStopLifecycleWorker: vi.fn().mockResolvedValue(false),
  mockPromptConfirm: vi.fn().mockResolvedValue(true),
  mockIsHumanCaller: vi.fn().mockReturnValue(false),
}));

vi.mock("@composio/ao-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@composio/ao-core")>();
  return {
    ...actual,
    loadGlobalConfig: mockLoadGlobalConfig,
    saveGlobalConfig: mockSaveGlobalConfig,
    unregisterProject: mockUnregisterProject,
    deleteShadowFile: mockDeleteShadowFile,
    loadConfig: mockLoadConfig,
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async (): Promise<SessionManager> => mockSessionManager as unknown as SessionManager,
}));

vi.mock("../../src/lib/lifecycle-service.js", () => ({
  stopLifecycleWorker: (...args: unknown[]) => mockStopLifecycleWorker(...args),
}));

vi.mock("../../src/lib/prompts.js", () => ({
  promptConfirm: (...args: unknown[]) => mockPromptConfirm(...args),
}));

vi.mock("../../src/lib/caller-context.js", () => ({
  isHumanCaller: () => mockIsHumanCaller(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { registerRemoveProject } from "../../src/commands/remove-project.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGlobalConfig(
  projectIds: string[] = ["my-project"],
): GlobalConfig {
  const projects: GlobalConfig["projects"] = {};
  for (const id of projectIds) {
    projects[id] = { name: id, path: `/home/user/${id}` } as GlobalConfig["projects"][string];
  }
  return {
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: ["composio", "desktop"] },
    projects,
  } as GlobalConfig;
}

function runCommand(args: string[]): Promise<Command> {
  const program = new Command();
  program.exitOverride();
  registerRemoveProject(program);
  return program.parseAsync(["node", "ao", ...args]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ao remove-project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStopLifecycleWorker.mockResolvedValue(false);
    mockPromptConfirm.mockResolvedValue(true);
    mockIsHumanCaller.mockReturnValue(false);
    mockSessionManager.list.mockResolvedValue([]);
    mockUnregisterProject.mockImplementation((cfg: GlobalConfig, id: string) => {
      const updated = { ...cfg, projects: { ...cfg.projects } };
      delete updated.projects[id];
      return updated;
    });
    mockLoadConfig.mockReturnValue(makeGlobalConfig());
  });

  it("removes a project when found in global config", async () => {
    const globalConfig = makeGlobalConfig(["my-project"]);
    mockLoadGlobalConfig.mockReturnValue(globalConfig);

    await runCommand(["remove-project", "my-project", "--force"]);

    expect(mockUnregisterProject).toHaveBeenCalledWith(globalConfig, "my-project");
    expect(mockSaveGlobalConfig).toHaveBeenCalled();
    expect(mockDeleteShadowFile).toHaveBeenCalledWith("my-project");
  });

  it("exits with error when global config is not found", async () => {
    mockLoadGlobalConfig.mockReturnValue(null);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    await expect(runCommand(["remove-project", "nonexistent", "--force"])).rejects.toThrow();
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });

  it("exits with error when project ID is not in global config", async () => {
    mockLoadGlobalConfig.mockReturnValue(makeGlobalConfig(["other-project"]));
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    await expect(runCommand(["remove-project", "nonexistent", "--force"])).rejects.toThrow();
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });

  it("shows active sessions and includes orphan warning in prompt", async () => {
    mockLoadGlobalConfig.mockReturnValue(makeGlobalConfig(["my-project"]));
    mockSessionManager.list.mockResolvedValue([{ id: "my-project-session-1" }, { id: "my-project-session-2" }]);
    mockIsHumanCaller.mockReturnValue(true);
    mockPromptConfirm.mockResolvedValue(true);

    await runCommand(["remove-project", "my-project"]);

    expect(mockPromptConfirm).toHaveBeenCalledWith(
      expect.stringContaining("active sessions will be orphaned"),
      false,
    );
  });

  it("cancels when user declines confirmation", async () => {
    mockLoadGlobalConfig.mockReturnValue(makeGlobalConfig(["my-project"]));
    mockIsHumanCaller.mockReturnValue(true);
    mockPromptConfirm.mockResolvedValue(false);

    await runCommand(["remove-project", "my-project"]);

    expect(mockSaveGlobalConfig).not.toHaveBeenCalled();
    expect(mockDeleteShadowFile).not.toHaveBeenCalled();
  });

  it("skips confirmation prompt with --force flag", async () => {
    mockLoadGlobalConfig.mockReturnValue(makeGlobalConfig(["my-project"]));
    mockIsHumanCaller.mockReturnValue(true);

    await runCommand(["remove-project", "my-project", "--force"]);

    expect(mockPromptConfirm).not.toHaveBeenCalled();
    expect(mockSaveGlobalConfig).toHaveBeenCalled();
  });

  it("skips confirmation prompt for non-human callers", async () => {
    mockLoadGlobalConfig.mockReturnValue(makeGlobalConfig(["my-project"]));
    mockIsHumanCaller.mockReturnValue(false);

    await runCommand(["remove-project", "my-project"]);

    expect(mockPromptConfirm).not.toHaveBeenCalled();
    expect(mockSaveGlobalConfig).toHaveBeenCalled();
  });

  it("stops lifecycle worker for the project before removing", async () => {
    mockLoadGlobalConfig.mockReturnValue(makeGlobalConfig(["my-project"]));

    await runCommand(["remove-project", "my-project", "--force"]);

    expect(mockStopLifecycleWorker).toHaveBeenCalledWith(expect.anything(), "my-project");
  });

  it("proceeds even when stopLifecycleWorker throws", async () => {
    mockLoadGlobalConfig.mockReturnValue(makeGlobalConfig(["my-project"]));
    mockStopLifecycleWorker.mockRejectedValue(new Error("worker error"));

    await runCommand(["remove-project", "my-project", "--force"]);

    // Should still remove
    expect(mockSaveGlobalConfig).toHaveBeenCalled();
    expect(mockDeleteShadowFile).toHaveBeenCalledWith("my-project");
  });

  it("proceeds when session manager throws", async () => {
    mockLoadGlobalConfig.mockReturnValue(makeGlobalConfig(["my-project"]));
    mockLoadConfig.mockImplementation(() => { throw new Error("no config"); });

    await runCommand(["remove-project", "my-project", "--force"]);

    expect(mockSaveGlobalConfig).toHaveBeenCalled();
  });
});
