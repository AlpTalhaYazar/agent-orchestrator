import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { gatherContext } from "../context.js";
import { invokePlanner } from "../planner.js";

export function registerPlan(program: Command): void {
  program
    .command("plan")
    .description("Generate an execution plan without running workers")
    .argument("<task>", "Task description in natural language")
    .option("--provider <provider>", "LLM provider (anthropic|openai)")
    .option("--model <model>", "Planner model")
    .option("--thinking <effort>", "Thinking effort (low|medium|high)")
    .option("--repo <path>", "Repository path (default: cwd)")
    .option("--json", "Output as JSON")
    .action(async (task: string, options: Record<string, string | boolean | undefined>) => {
      const repoPath = (options.repo as string) ?? process.cwd();
      const overrides = buildOverrides(options);
      const config = loadConfig(overrides, repoPath);

      console.log("Gathering context...");
      const context = await gatherContext(repoPath, config.context);

      console.log("Invoking planner...");
      const plan = await invokePlanner(task, context, config);

      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      if (plan.summary) {
        console.log(`\nSummary: ${plan.summary}`);
      }
      console.log(`\nPlan (${plan.subtasks.length} subtasks):`);
      for (const s of plan.subtasks) {
        const deps = s.dependencies.length > 0 ? ` [depends on: ${s.dependencies.join(", ")}]` : "";
        const cli = s.workerCli ? ` (${s.workerCli})` : "";
        console.log(`  ${s.id}. ${s.description}${deps}${cli}`);
      }
    });
}

function buildOverrides(options: Record<string, string | boolean | undefined>): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const planner: Record<string, unknown> = {};

  if (options.provider) planner.provider = options.provider;
  if (options.model) planner.model = options.model;
  if (options.thinking) planner.thinking_effort = options.thinking;

  if (Object.keys(planner).length > 0) overrides.planner = planner;
  return overrides;
}
