import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type {
  RepoContext,
  PlanOutput,
  RevisionOutput,
  WorkerResult,
  Subtask,
} from "./types.js";
import { PlanOutputSchema, RevisionOutputSchema } from "./types.js";
import type { OrchestratorTomlConfig } from "./config.js";

const execFileAsync = promisify(execFile);

/** Threshold (chars) above which prompts are written to a temp file. */
const LONG_PROMPT_THRESHOLD = 4000;

// =============================================================================
// CLI AGENT INVOCATION
// =============================================================================

/**
 * Invoke a CLI agent in --print mode and return its stdout.
 * For long prompts, writes to a temp file and pipes via stdin.
 */
export async function invokeCliAgent(
  cli: string,
  prompt: string,
  model?: string,
): Promise<string> {
  if (prompt.length > LONG_PROMPT_THRESHOLD) {
    return invokeViaStdin(cli, prompt, model);
  }
  return invokeViaArgs(cli, prompt, model);
}

async function invokeViaArgs(
  cli: string,
  prompt: string,
  model?: string,
): Promise<string> {
  const args = buildCliArgs(cli, prompt, model);
  const { stdout, stderr } = await execFileAsync(cli, args, {
    maxBuffer: 50 * 1024 * 1024, // 50MB
    timeout: 10 * 60 * 1000, // 10 min
  });
  return stdout;
}

async function invokeViaStdin(
  cli: string,
  prompt: string,
  model?: string,
): Promise<string> {
  const args = buildCliArgs(cli, undefined, model);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cli, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString("utf-8");
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8");
      });

      child.on("error", (err) => {
        reject(
          new Error(`Failed to spawn ${cli}: ${err.message}`, { cause: err }),
        );
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `${cli} exited with code ${code}: ${stderr.slice(0, 2000)}`,
            ),
          );
        } else {
          resolve(stdout);
        }
      });

      // Pipe prompt via stdin
      child.stdin?.write(prompt);
      child.stdin?.end();
    });
}

function buildCliArgs(
  cli: string,
  prompt?: string,
  model?: string,
): string[] {
  const args: string[] = ["--print"];

  if (prompt !== undefined) {
    args.push("-p", prompt);
  }

  if (model) {
    args.push("--model", model);
  }

  return args;
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

/**
 * Build the initial planning prompt with task + repo context.
 */
export function buildPlannerPrompt(task: string, context: RepoContext): string {
  const sections: string[] = [];

  sections.push(
    `You are a task planner for a software project. Given a task description and repository context, decompose the task into subtasks that can be executed by worker agents.`,
  );

  sections.push(`\n## Repository Context`);

  if (context.directoryTree) {
    sections.push(`\n### Directory Structure\n\`\`\`\n${context.directoryTree}\n\`\`\``);
  }

  const configEntries = Object.entries(context.configFiles);
  if (configEntries.length > 0) {
    sections.push(`\n### Config Files`);
    for (const [name, content] of configEntries) {
      // Truncate large config files
      const truncated =
        content.length > 2000
          ? content.slice(0, 2000) + "\n... (truncated)"
          : content;
      sections.push(`\n#### ${name}\n\`\`\`\n${truncated}\n\`\`\``);
    }
  }

  if (context.readme) {
    const truncated =
      context.readme.length > 3000
        ? context.readme.slice(0, 3000) + "\n... (truncated)"
        : context.readme;
    sections.push(`\n### README\n${truncated}`);
  }

  if (context.claudeMd) {
    const truncated =
      context.claudeMd.length > 3000
        ? context.claudeMd.slice(0, 3000) + "\n... (truncated)"
        : context.claudeMd;
    sections.push(`\n### CLAUDE.md\n${truncated}`);
  }

  if (context.gitLog) {
    sections.push(`\n### Recent Git History\n\`\`\`\n${context.gitLog}\n\`\`\``);
  }

  sections.push(`\n## Task\n${task}`);

  sections.push(`\n## Output Format
Respond with ONLY a JSON object matching this schema:
\`\`\`json
{
  "subtasks": [
    { "id": "1", "description": "...", "dependencies": [], "workerCli": "claude" },
    { "id": "2", "description": "...", "dependencies": ["1"] }
  ],
  "summary": "Brief plan summary"
}
\`\`\`

Rules:
- Each subtask must have a unique string ID
- dependencies is an array of subtask IDs that must complete before this one starts
- workerCli is optional (defaults to config default)
- Minimize subtask count — only split when work is truly independent or sequential
- Mark independent tasks with empty dependencies for parallel execution
- Respond with ONLY the JSON, no other text`);

  return sections.join("\n");
}

/**
 * Build the revision prompt after workers complete.
 */
export function buildRevisionPrompt(
  task: string,
  subtasks: Subtask[],
  results: WorkerResult[],
): string {
  const sections: string[] = [];

  sections.push(
    `You are reviewing worker outputs for a software task. Decide if the task is done or needs follow-up work.`,
  );

  sections.push(`\n## Original Task\n${task}`);

  sections.push(`\n## Executed Subtasks and Results`);
  for (const subtask of subtasks) {
    const result = results.find((r) => r.subtaskId === subtask.id);
    sections.push(`\n### Subtask ${subtask.id}: ${subtask.description}`);
    sections.push(`Status: ${subtask.status}`);
    if (result) {
      sections.push(`Exit code: ${result.exitCode}`);
      if (result.timedOut) sections.push(`(TIMED OUT)`);
      // Truncate long output
      const stdout =
        result.stdout.length > 3000
          ? result.stdout.slice(0, 3000) + "\n... (truncated)"
          : result.stdout;
      if (stdout) sections.push(`Output:\n\`\`\`\n${stdout}\n\`\`\``);
      if (result.stderr) {
        const stderr =
          result.stderr.length > 1000
            ? result.stderr.slice(0, 1000) + "\n... (truncated)"
            : result.stderr;
        sections.push(`Stderr:\n\`\`\`\n${stderr}\n\`\`\``);
      }
    }
  }

  sections.push(`\n## Output Format
Respond with ONLY a JSON object:
\`\`\`json
{
  "done": true,
  "summary": "What was accomplished or what still needs work",
  "followUpSubtasks": []
}
\`\`\`

If done is false, include followUpSubtasks with new tasks to address remaining work.
Respond with ONLY the JSON, no other text.`);

  return sections.join("\n");
}

// =============================================================================
// JSON EXTRACTION
// =============================================================================

/**
 * Extract JSON from agent output that may contain prose or markdown fences.
 * Tries: direct parse, code fence extraction, brace matching.
 */
export function extractJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();

  // Strategy 1: Direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to other strategies
  }

  // Strategy 2: Extract from ```json code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // Strategy 3: Find first { to last matching }
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    let lastBrace = -1;
    for (let i = firstBrace; i < trimmed.length; i++) {
      if (trimmed[i] === "{") depth++;
      else if (trimmed[i] === "}") {
        depth--;
        if (depth === 0) {
          lastBrace = i;
          // Don't break — find the LAST complete top-level object
        }
      }
    }
    if (lastBrace !== -1) {
      // Try from first { to the last matching }
      // We need to find the right pair — let's re-do with proper matching
      depth = 0;
      for (let i = firstBrace; i < trimmed.length; i++) {
        if (trimmed[i] === "{") depth++;
        else if (trimmed[i] === "}") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(trimmed.slice(firstBrace, i + 1));
            } catch {
              // Continue scanning
            }
          }
        }
      }
    }
  }

  throw new Error(
    `Could not extract JSON from agent output (${trimmed.length} chars). First 200 chars: ${trimmed.slice(0, 200)}`,
  );
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Invoke the planner agent and return a validated PlanOutput.
 */
export async function invokePlanner(
  task: string,
  context: RepoContext,
  config: OrchestratorTomlConfig,
): Promise<PlanOutput> {
  const prompt = buildPlannerPrompt(task, context);
  const output = await invokeCliAgent(
    config.planner.cli,
    prompt,
    config.planner.model,
  );
  const json = extractJsonFromOutput(output);
  return PlanOutputSchema.parse(json);
}

/**
 * Invoke the planner for revision and return a validated RevisionOutput.
 */
export async function invokePlannerRevision(
  task: string,
  currentSubtasks: Subtask[],
  workerResults: WorkerResult[],
  config: OrchestratorTomlConfig,
): Promise<RevisionOutput> {
  const prompt = buildRevisionPrompt(task, currentSubtasks, workerResults);
  const output = await invokeCliAgent(
    config.planner.cli,
    prompt,
    config.planner.model,
  );
  const json = extractJsonFromOutput(output);
  return RevisionOutputSchema.parse(json);
}
