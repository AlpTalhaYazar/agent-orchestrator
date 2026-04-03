import type { OrchestratorConfig } from "@composio/ao-core";

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Check whether a session name matches a project prefix (strict: prefix-\d+ only). */
export function matchesPrefix(sessionName: string, prefix: string): boolean {
  return new RegExp(`^${escapeRegex(prefix)}-\\d+$`).test(sessionName);
}

/** Find which project a session belongs to by matching its name against session prefixes. */
export function findProjectForSession(
  config: OrchestratorConfig,
  sessionName: string,
): string | null {
  for (const [id, project] of Object.entries(config.projects) as Array<
    [string, OrchestratorConfig["projects"][string]]
  >) {
    const prefix = project.sessionPrefix || id;
    if (matchesPrefix(sessionName, prefix)) {
      return id;
    }
  }
  return null;
}

export function isOrchestratorSessionName(
  config: OrchestratorConfig,
  sessionName: string,
  projectId?: string,
): boolean {
  if (projectId) {
    const project = config.projects[projectId];
    if (project) {
      const prefix = project.sessionPrefix || projectId;
      if (
        sessionName === `${prefix}-orchestrator` ||
        new RegExp(`^${escapeRegex(prefix)}-orchestrator-\\d+$`).test(sessionName)
      ) {
        return true;
      }
    }
  }

  // If sessionName is a numbered worker for any configured project, it is not an orchestrator.
  // This prevents cross-project false positives where one project's prefix is another's
  // {prefix}-orchestrator (e.g. prefix "app" matching "app-orchestrator-1" as orchestrator
  // when "app-orchestrator-1" is actually a worker for a project with prefix "app-orchestrator").
  for (const [id, project] of Object.entries(config.projects) as Array<
    [string, OrchestratorConfig["projects"][string]]
  >) {
    const prefix = project.sessionPrefix || id;
    if (matchesPrefix(sessionName, prefix)) return false;
  }

  for (const [id, project] of Object.entries(config.projects) as Array<
    [string, OrchestratorConfig["projects"][string]]
  >) {
    const prefix = project.sessionPrefix || id;
    if (
      sessionName === `${prefix}-orchestrator` ||
      new RegExp(`^${escapeRegex(prefix)}-orchestrator-\\d+$`).test(sessionName)
    ) {
      return true;
    }
  }

  return sessionName.endsWith("-orchestrator");
}
