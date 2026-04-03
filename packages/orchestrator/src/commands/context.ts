import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { gatherContext } from "../context.js";

export function registerContext(program: Command): void {
  program
    .command("context")
    .description("Gather and display repository context (no LLM calls)")
    .option("--repo <path>", "Repository path (default: cwd)")
    .option("--json", "Output as JSON")
    .action(async (options: { repo?: string; json?: boolean }) => {
      const repoPath = options.repo ?? process.cwd();
      const config = loadConfig(undefined, repoPath);
      const context = await gatherContext(repoPath, config.context);

      if (options.json) {
        console.log(JSON.stringify(context, null, 2));
        return;
      }

      if (context.directoryTree) {
        console.log("=== Directory Tree ===");
        console.log(context.directoryTree);
        console.log();
      }

      const configEntries = Object.entries(context.configFiles);
      if (configEntries.length > 0) {
        console.log("=== Config Files ===");
        for (const [name, content] of configEntries) {
          console.log(`--- ${name} ---`);
          console.log(content.length > 2000 ? content.slice(0, 2000) + "\n... (truncated)" : content);
          console.log();
        }
      }

      if (context.readme) {
        console.log("=== README.md ===");
        console.log(context.readme.length > 3000 ? context.readme.slice(0, 3000) + "\n... (truncated)" : context.readme);
        console.log();
      }

      if (context.claudeMd) {
        console.log("=== CLAUDE.md ===");
        console.log(context.claudeMd.length > 3000 ? context.claudeMd.slice(0, 3000) + "\n... (truncated)" : context.claudeMd);
        console.log();
      }

      if (context.gitLog) {
        console.log("=== Recent Git History ===");
        console.log(context.gitLog);
      }
    });
}
