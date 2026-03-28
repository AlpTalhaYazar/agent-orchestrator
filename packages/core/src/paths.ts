/**
 * Path utilities for hash-based directory structure.
 *
 * Architecture:
 * - Config location determines hash: sha256(dirname(configPath)).slice(0, 12)
 * - Each project gets directory: ~/.agent-orchestrator/{hash}-{projectId}/
 * - Sessions inside: sessions/{sessionName} (no hash prefix, already namespaced)
 * - Tmux names include hash for global uniqueness: {hash}-{prefix}-{num}
 */

import { createHash } from "node:crypto";
import { dirname, basename, join } from "node:path";
import { homedir } from "node:os";
import {
  realpathSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  renameSync,
} from "node:fs";

/**
 * Generate a 12-character hash from a config directory path.
 * Always resolves symlinks before hashing to ensure consistency.
 *
 * @deprecated Use generateProjectHash(projectPath) for Option C.
 * Kept for backwards compat and migration.
 */
export function generateConfigHash(configPath: string): string {
  const resolved = realpathSync(configPath);
  const configDir = dirname(resolved);
  const hash = createHash("sha256").update(configDir).digest("hex");
  return hash.slice(0, 12);
}

/**
 * Generate a 12-character hash from a project path.
 * This is stable regardless of which config file loaded the project,
 * making it safe for Option C's hybrid local + global config model.
 */
export function generateProjectHash(projectPath: string): string {
  const resolved = realpathSync(projectPath);
  const hash = createHash("sha256").update(resolved).digest("hex");
  return hash.slice(0, 12);
}

/**
 * Generate project ID from project path (basename of the path).
 * Example: ~/repos/integrator → "integrator"
 */
export function generateProjectId(projectPath: string): string {
  return basename(projectPath);
}

/**
 * Generate instance ID combining hash and project ID.
 * Format: {hash}-{projectId}
 * Example: "a3b4c5d6e7f8-integrator"
 *
 * @deprecated Use generateInstanceIdFromProject(projectPath) for Option C.
 */
export function generateInstanceId(configPath: string, projectPath: string): string {
  const hash = generateConfigHash(configPath);
  const projectId = generateProjectId(projectPath);
  return `${hash}-${projectId}`;
}

/**
 * Generate instance ID from project path only (Option C).
 * Format: {projectHash}-{projectId}
 */
export function generateInstanceIdFromProject(projectPath: string): string {
  const hash = generateProjectHash(projectPath);
  const projectId = generateProjectId(projectPath);
  return `${hash}-${projectId}`;
}

/**
 * Generate session prefix from project ID using clean heuristics.
 *
 * Rules:
 * 1. ≤4 chars: use as-is (lowercase)
 * 2. CamelCase: extract uppercase letters (PyTorch → pt)
 * 3. kebab/snake case: use initials (agent-orchestrator → ao)
 * 4. Single word: first 3 chars (integrator → int)
 */
export function generateSessionPrefix(projectId: string): string {
  if (projectId.length <= 4) {
    return projectId.toLowerCase();
  }

  // CamelCase: extract uppercase letters
  const uppercase = projectId.match(/[A-Z]/g);
  if (uppercase && uppercase.length > 1) {
    return uppercase.join("").toLowerCase();
  }

  // kebab-case or snake_case: use initials
  if (projectId.includes("-") || projectId.includes("_")) {
    const separator = projectId.includes("-") ? "-" : "_";
    return projectId
      .split(separator)
      .map((word) => word[0])
      .join("")
      .toLowerCase();
  }

  // Single word: first 3 characters
  return projectId.slice(0, 3).toLowerCase();
}

/**
 * Get the project base directory for a given config and project.
 * Format: ~/.agent-orchestrator/{hash}-{projectId}
 *
 * Accepts either (configPath, projectPath) for backwards compat
 * or just (projectPath) for Option C mode.
 */
export function getProjectBaseDir(configPathOrProjectPath: string, projectPath?: string): string {
  if (projectPath !== undefined) {
    // Legacy mode: (configPath, projectPath)
    const instanceId = generateInstanceId(configPathOrProjectPath, projectPath);
    return join(expandHome("~/.agent-orchestrator"), instanceId);
  }
  // Option C mode: (projectPath)
  const instanceId = generateInstanceIdFromProject(configPathOrProjectPath);
  return join(expandHome("~/.agent-orchestrator"), instanceId);
}

/**
 * Get the shared observability base directory for a config.
 * Format: ~/.agent-orchestrator/{hash}-observability
 */
export function getObservabilityBaseDir(configPath: string): string {
  const hash = generateConfigHash(configPath);
  return join(expandHome("~/.agent-orchestrator"), `${hash}-observability`);
}

/**
 * Get the sessions directory for a project.
 * Format: ~/.agent-orchestrator/{hash}-{projectId}/sessions
 *
 * Accepts either (configPath, projectPath) for backwards compat
 * or just (projectPath) for Option C mode.
 */
export function getSessionsDir(configPathOrProjectPath: string, projectPath?: string): string {
  if (projectPath !== undefined) {
    return join(getProjectBaseDir(configPathOrProjectPath, projectPath), "sessions");
  }
  return join(getProjectBaseDir(configPathOrProjectPath), "sessions");
}

/**
 * Get the worktrees directory for a project.
 * Format: ~/.agent-orchestrator/{hash}-{projectId}/worktrees
 */
export function getWorktreesDir(configPathOrProjectPath: string, projectPath?: string): string {
  if (projectPath !== undefined) {
    return join(getProjectBaseDir(configPathOrProjectPath, projectPath), "worktrees");
  }
  return join(getProjectBaseDir(configPathOrProjectPath), "worktrees");
}

/**
 * Get the feedback reports directory for a project.
 * Format: ~/.agent-orchestrator/{hash}-{projectId}/feedback-reports
 */
export function getFeedbackReportsDir(
  configPathOrProjectPath: string,
  projectPath?: string,
): string {
  if (projectPath !== undefined) {
    return join(getProjectBaseDir(configPathOrProjectPath, projectPath), "feedback-reports");
  }
  return join(getProjectBaseDir(configPathOrProjectPath), "feedback-reports");
}

/**
 * Get the archive directory for a project.
 * Format: ~/.agent-orchestrator/{hash}-{projectId}/archive
 */
export function getArchiveDir(configPathOrProjectPath: string, projectPath?: string): string {
  if (projectPath !== undefined) {
    return join(getSessionsDir(configPathOrProjectPath, projectPath), "archive");
  }
  return join(getSessionsDir(configPathOrProjectPath), "archive");
}

/**
 * Get the .origin file path for a project.
 * This file stores the project path for collision detection.
 */
export function getOriginFilePath(
  configPathOrProjectPath: string,
  projectPath?: string,
): string {
  if (projectPath !== undefined) {
    return join(getProjectBaseDir(configPathOrProjectPath, projectPath), ".origin");
  }
  return join(getProjectBaseDir(configPathOrProjectPath), ".origin");
}

/**
 * Generate user-facing session name.
 * Format: {prefix}-{num}
 * Example: "int-1", "ao-42"
 */
export function generateSessionName(prefix: string, num: number): string {
  return `${prefix}-${num}`;
}

/**
 * Generate tmux session name (globally unique).
 * Format: {hash}-{prefix}-{num}
 *
 * Accepts either (configPath, prefix, num) for backwards compat
 * or uses project hash when configPath is actually a projectPath.
 */
export function generateTmuxName(configPath: string, prefix: string, num: number): string {
  const hash = generateConfigHash(configPath);
  return `${hash}-${prefix}-${num}`;
}

/**
 * Generate tmux session name using project hash (Option C).
 * Format: {projectHash}-{prefix}-{num}
 */
export function generateTmuxNameFromProject(
  projectPath: string,
  prefix: string,
  num: number,
): string {
  const hash = generateProjectHash(projectPath);
  return `${hash}-${prefix}-${num}`;
}

/**
 * Parse a tmux session name to extract components.
 * Returns null if the name doesn't match the expected format.
 */
export function parseTmuxName(tmuxName: string): {
  hash: string;
  prefix: string;
  num: number;
} | null {
  const match = tmuxName.match(/^([a-f0-9]{12})-([a-zA-Z0-9_-]+)-(\d+)$/);
  if (!match) return null;

  return {
    hash: match[1],
    prefix: match[2],
    num: parseInt(match[3], 10),
  };
}

/**
 * Expand ~ to home directory.
 */
export function expandHome(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return join(homedir(), filepath.slice(2));
  }
  return filepath;
}

/**
 * Validate and store the .origin file for a project.
 * Throws if a hash collision is detected (different project path, same hash).
 *
 * Option C: stores resolved projectPath (not configPath) in .origin.
 * Legacy (configPath, projectPath) signature still supported.
 */
export function validateAndStoreOrigin(configPath: string, projectPath: string): void {
  const originPath = getOriginFilePath(configPath, projectPath);
  const resolvedConfigPath = realpathSync(configPath);

  if (existsSync(originPath)) {
    const stored = readFileSync(originPath, "utf-8").trim();
    if (stored !== resolvedConfigPath) {
      throw new Error(
        `Hash collision detected!\n` +
          `Directory: ${getProjectBaseDir(configPath, projectPath)}\n` +
          `Expected config: ${resolvedConfigPath}\n` +
          `Actual config: ${stored}\n` +
          `This is a rare hash collision. Please move one of the configs to a different directory.`,
      );
    }
  } else {
    // Create project base directory and .origin file
    const baseDir = getProjectBaseDir(configPath, projectPath);
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(originPath, resolvedConfigPath, "utf-8");
  }
}

// =============================================================================
// MIGRATION — Old config-hash dirs → new project-hash dirs
// =============================================================================

export interface MigrationResult {
  projectId: string;
  oldDir: string;
  newDir: string;
  renamed: boolean;
  error?: string;
}

/**
 * Migrate session directories from old config-hash-based naming to
 * new project-hash-based naming (Option C).
 *
 * Scans ~/.agent-orchestrator/ for {oldHash}-{projectId} directories,
 * computes the new hash from project.path, and renames.
 * Updates .origin files to store the project path.
 *
 * Safe: skips if new dir already exists, logs all actions.
 */
export function migrateSessionDirs(
  oldConfigPath: string,
  projects: Record<string, { path: string }>,
): MigrationResult[] {
  const results: MigrationResult[] = [];
  const aoBase = expandHome("~/.agent-orchestrator");

  if (!existsSync(aoBase)) return results;

  const oldHash = generateConfigHash(oldConfigPath);

  for (const [projectKey, project] of Object.entries(projects)) {
    const projectId = generateProjectId(project.path);
    const oldInstanceId = `${oldHash}-${projectId}`;
    const oldDir = join(aoBase, oldInstanceId);

    if (!existsSync(oldDir)) {
      continue; // Nothing to migrate for this project
    }

    const newInstanceId = generateInstanceIdFromProject(project.path);
    const newDir = join(aoBase, newInstanceId);

    if (oldDir === newDir) {
      // Hash happens to be the same — no migration needed
      results.push({ projectId: projectKey, oldDir, newDir, renamed: false });
      continue;
    }

    if (existsSync(newDir)) {
      results.push({
        projectId: projectKey,
        oldDir,
        newDir,
        renamed: false,
        error: `Target directory already exists: ${newDir}`,
      });
      continue;
    }

    try {
      renameSync(oldDir, newDir);

      // Update .origin file to store project path instead of config path
      const originPath = join(newDir, ".origin");
      const resolvedProjectPath = realpathSync(project.path);
      writeFileSync(originPath, resolvedProjectPath, "utf-8");

      results.push({ projectId: projectKey, oldDir, newDir, renamed: true });
    } catch (err) {
      results.push({
        projectId: projectKey,
        oldDir,
        newDir,
        renamed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
