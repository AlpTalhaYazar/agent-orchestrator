import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { orchestrate } from "../loop.js";

export function registerRun(program: Command): void {
  program
    .command("run")
    .description("Run the orchestrator: gather context, plan, dispatch workers, iterate")
    .argument("<task>", "Task description in natural language")
    .option("--provider <provider>", "LLM provider (anthropic|openai)")
    .option("--model <model>", "Planner model")
    .option("--thinking <effort>", "Thinking effort (low|medium|high)")
    .option("--workers <count>", "Max parallel workers", parseInt)
    .option("--timeout <minutes>", "Worker timeout in minutes", parseInt)
    .option("--max-rounds <rounds>", "Max planning rounds", parseInt)
    .option("--cli <cli>", "Default worker CLI (claude|codex)")
    .option("--no-worktree", "Disable git worktrees")
    .option("--repo <path>", "Repository path (default: cwd)")
    .action(async (task: string, options: Record<string, string | number | boolean | undefined>) => {
      const repoPath = (options.repo as string) ?? process.cwd();
      const overrides = buildOverrides(options);
      const config = loadConfig(overrides, repoPath);

      const result = await orchestrate(task, repoPath, config, {
        onContextGathered: () => {
          console.log("Context gathered.");
        },
        onPlanReady: (plan) => {
          console.log(`\nPlan (${plan.subtasks.length} subtasks):`);
          for (const s of plan.subtasks) {
            const deps = s.dependencies.length > 0 ? ` [deps: ${s.dependencies.join(", ")}]` : "";
            console.log(`  ${s.id}. ${s.description}${deps}`);
          }
          console.log();
        },
        onWorkerComplete: (r) => {
          const icon = r.exitCode === 0 ? "OK" : r.exitCode === -1 ? "SKIP" : "FAIL";
          console.log(`  [${icon}] Subtask ${r.subtaskId} (${r.durationMs}ms)`);
        },
        onRevision: (rev, round) => {
          console.log(`\nRound ${round} revision: ${rev.done ? "DONE" : "CONTINUE"}`);
          if (rev.followUpSubtasks.length > 0) {
            console.log(`  Follow-up subtasks: ${rev.followUpSubtasks.length}`);
          }
        },
        onComplete: (r) => {
          console.log(`\nCompleted in ${r.rounds} round(s), ${r.totalDurationMs}ms total`);
          console.log(`\n${r.finalSummary}`);
        },
      });

      // Exit with non-zero if any subtask failed
      const anyFailed = result.subtasks.some((s) => s.status === "failed");
      if (anyFailed) process.exitCode = 1;
    });
}

function buildOverrides(options: Record<string, string | number | boolean | undefined>): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const planner: Record<string, unknown> = {};
  const workers: Record<string, unknown> = {};
  const git: Record<string, unknown> = {};

  if (options.provider) planner.provider = options.provider;
  if (options.model) planner.model = options.model;
  if (options.thinking) planner.thinking_effort = options.thinking;
  if (options.maxRounds) planner.max_rounds = options.maxRounds;

  if (options.cli) workers.cli = options.cli;
  if (options.workers) workers.max_parallel = options.workers;
  if (options.timeout) workers.timeout_minutes = options.timeout;

  if (options.worktree === false) git.worktree_enabled = false;

  if (Object.keys(planner).length > 0) overrides.planner = planner;
  if (Object.keys(workers).length > 0) overrides.workers = workers;
  if (Object.keys(git).length > 0) overrides.git = git;

  return overrides;
}
