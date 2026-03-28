docs

Search
⌘
K
ao




Agent Orchestrator
Multi-Project Architecture
Multi-project config, session registry, dashboard, and CLI architecture for agent-orchestrator.

Finalized · 2026-03-28 · Harsh Batheja

Problem Statement
agent-orchestrator currently behaves like a single-project tool. Each project has its own config, its own session registry, and effectively its own dashboard universe. That makes cross-project visibility and navigation awkward even though the product is conceptually trying to answer a broader question: what is happening across all my projects right now?

This document defines the architecture for:

multi-project support
a project-based dashboard with a portfolio landing page at /
The goal is not to redesign every part of the product. The goal is to establish a coherent multi-project model for config ownership, session storage, routing, dashboard behavior, and CLI flows.

Concrete pain points today
You cannot see all projects in one dashboard instance.
ao status only shows sessions from whichever project config is loaded.
The sidebar exists visually, but it is not backed by a real global project model.
Dashboard routing is centered around a single project view instead of a portfolio + project hierarchy.
Portfolio-level navigation and project-level navigation are not clearly separated.
Project identity is spread across local config fields instead of a dedicated global registry.
Current Architecture
Config loading
loadConfig() loads a single config file and treats it as the only source of truth for the running process.


cwd
 |
 |-- agent-orchestrator.yaml   <-- findConfigFile() walks up from here
 |
 '-- If not found: ~/.agent-orchestrator.yaml
                   ~/.config/agent-orchestrator/config.yaml
In practice, this means one process sees one project universe at a time.

Config ownership
The current local config mixes together two different responsibilities:

project identity / registry information such as where a project lives and how it is identified
project behavior such as tracker, scm, agent, reactions, runtime, and other execution settings
That is manageable in a single-project world, but it becomes awkward once multiple projects must be registered and displayed together.

Session storage
Session data is currently isolated by config-derived paths.


~/.agent-orchestrator/
  {hash}-{projectId}/
    sessions/
    worktrees/
That layout works today and does not need to change for the multi-project dashboard.

Dashboard behavior
The existing dashboard is effectively a single-project dashboard:

current main content is the project kanban view
project awareness comes from the single loaded config
sidebar rendering is constrained by that single-project model
routing does not clearly separate portfolio view from project view
The current implementation has pieces of multi-project UI thinking, but not a real multi-project architecture underneath it.

Config Strategy: Hybrid (local + shadow)
Local config is the source of truth. The global config keeps a shadow copy of each project's behavior settings so CLI commands work from anywhere.


# Local (~/projects/agent-orchestrator/agent-orchestrator.yaml) — source of truth
repo: org/agent-orchestrator
agent: claude-code
runtime: tmux
tracker: github
agentConfig:
  permissions: auto-edit
  model: claude-sonnet-4-6
# Global (~/.agent-orchestrator/config.yaml) — registry + shadow copies
projects:
  ao:
    name: Agent Orchestrator
    path: ~/projects/agent-orchestrator
    # shadow copy (synced from local on ao start):
    agent: claude-code
    runtime: tmux
    tracker: github
    agentConfig:
      permissions: auto-edit
      model: claude-sonnet-4-6
  ds:
    name: Docs Server
    path: ~/projects/docs-server
    agent: opencode
    runtime: tmux
How it works
ao start in a project directory reads the local config and copies its behavior settings into the global config as a shadow. Only that project's shadow is updated.
Commands run from the project directory use the local config directly.
Commands run from elsewhere (e.g., ao spawn --project ao 123) use the shadow copy in the global config.
If no local config exists (Docker deployment, global-only usage), the global config entry is the only copy — used directly.
Sync rules
Shadow is updated only on ao start — not on every command, not mid-run
Each project syncs independently — ao start in project ao updates only ao's shadow
If someone edits the local config without running ao start, the shadow is stale. This is acceptable — config changes take effect on next ao start
No mid-run sync, no mtime checks, no file watchers
Design rationale
Local config lives with the code. Can be committed. Teammates get it on clone. Per-project isolation.
ao spawn --project ao 123 works from anywhere. One global config has everything needed for CLI ergonomics.
Docker works. If no local configs exist, the global config is self-sufficient — the system degrades gracefully to global-only mode.
Config in the repo is portable. Teams share a committed agent-orchestrator.yaml. Each team member only needs to register the project in their global config — behavior config is already there.
CLI from anywhere. Spawning agents across multiple projects without cd-ing into each one.
Failure isolation. A broken local config only affects that one project. Other projects keep running. Remote operations fall back to the shadow.
Edge Case Analysis
This section systematically enumerates every known edge case and states the resolution for each.

Edge case 1: Local config is edited between two ao start calls
Scenario: User edits agent-orchestrator.yaml while a project is running or stopped, then does not restart ao.

What happens: The shadow in the global config is stale. Any remote commands (ao spawn --project ao) use the old behavior settings from the shadow.

Resolution: This is intentional and acceptable. ao start is the explicit sync point. The user controls when config changes take effect. Display a warning in ao status if local config mtime is newer than the last shadow sync timestamp, e.g. "local config changed since last ao start — restart to sync".

Blocked? No.

Edge case 2: Local config is deleted after registration
Scenario: A project is registered in the global config with a shadow, but the local agent-orchestrator.yaml is later deleted or the repo is cleaned.

What happens: On next ao start from that directory, ao finds no local config. The shadow in global config is still present.

Resolution: Two sub-cases:

If user runs ao start from the project directory: ao detects no local config exists, prompts to create one or use global-only mode for this project. The shadow remains valid for remote commands.
If user runs a remote command (ao spawn --project ao): shadow is used directly. No local config required. Works as pure global-only mode until local config is recreated.
Shadow survives local config deletion. No data loss. No silent breakage.

Blocked? No.

Edge case 3: Project path changes (directory moved or renamed)
Scenario: User moves a project to a different directory. The global config still has the old path.

What happens: ao start from the old path fails silently or errors. The global registry entry points to a nonexistent path. ao spawn --project ao works as before (uses shadow) but sessions will launch in the wrong directory.

Resolution: Handled by the project move resilience design:

ao start detects path mismatch and prompts to update the registry entry.
A ao move-project <id> <new-path> command exists for explicit path updates.
Shadow is updated on the next successful ao start after the path is corrected.
See Project Move Resilience for the full spec.

Blocked? No.

Edge case 4: Two projects share the same path
Scenario: User registers two different project IDs pointing to the same directory path.

What happens: Both global registry entries point to the same local config. Both shadows are synced from the same source on ao start.

Resolution: Disallow duplicate paths at registration time. When ao start is run in a directory and a registry entry for that path already exists under a different ID, ao warns and either:

Refuses and asks the user to resolve the duplicate, or
Allows only if the user explicitly adds a second ID with a flag.
This is a constraint that must be enforced at registration, not at sync time.

Blocked? No.

Edge case 5: Shadow diverges from local config after a teammate pushes changes
Scenario: Project uses committed local config. Teammate pushes a new version of agent-orchestrator.yaml. Current user pulls but does not restart ao.

What happens: Local config is updated on disk. Shadow in global config is stale. Remote commands use old behavior.

Resolution: Same as edge case 1. The shadow syncs only on ao start. The ao status warning (mtime comparison) is especially useful for this case — after a pull, if local config mtime is newer than last sync, ao reminds the user.

For teams that want auto-sync on pull: this is out of scope for v1 but could be implemented via a git post-merge hook that calls ao start --sync-only.

ao start --sync-only (v2+): Updates the shadow in the global config from the local config without restarting the daemon. Does not affect in-memory config of running sessions. Requires the project to already be registered. Fails if local config is invalid. Intended for CI/CD pipelines and git hooks.

Blocked? No.

Edge case 6: Global config is deleted or corrupted
Scenario: User deletes ~/.agent-orchestrator/config.yaml or it becomes corrupt.

What happens: All project registry entries are lost. Shadows are lost. Local configs still exist on disk but are orphaned — ao does not know about them.

Resolution:

ao should warn before overwriting or deleting global config.
Recovery path: ao start in each project directory re-registers and re-syncs the shadow.
A ao export-config command could back up the global config.
Local configs survive independently. A user can rebuild the registry by running ao start in each project directory.

Blocked? No.

Edge case 7: Local config has fields that are not in the shadow schema
Scenario: A future version of ao adds new behavior fields to local config. An older global config schema does not know about these fields.

What happens: Shadow copy in global config silently drops unknown fields. Remote commands using the shadow miss the new fields.

Resolution: The shadow sync operation must be schema-version aware:

On ao start, ao writes the entire local config behavior section into the shadow — including fields it may not understand yet, as opaque passthrough.
The global config schema for each project's shadow should be a passthrough map for behavior fields, not a strict schema.
Strict schema validation applies only to identity fields (name, path, id) and global operational fields.
This requires shadow behavior fields to be stored as a loosely-typed map. This is a deliberate design constraint.

Blocked? No, but requires explicit schema design choice.

Edge case 8: ao start in a directory with no registered project
Scenario: User runs ao start in a project directory that is not yet in the global registry.

What happens: ao should auto-register it. But what if there is no local config either?

Resolution: Two sub-cases:

Local config exists: auto-register with inferred ID (from directory name or git remote). Prompt user to confirm ID. Sync shadow immediately.
No local config: scaffold local config interactively. Then register and sync.
Registration always requires an ID. If the inferred ID collides with an existing entry, ao prompts the user to choose a different ID.

Blocked? No.

Edge case 9: Docker deployment with no local configs
Scenario: ao runs in a Docker container. The operator mounts only the global config. No project directories are mounted.

What happens: All project entries in the global config have shadows but no local config path is accessible. ao start would fail if it requires a local config.

Resolution: ao start in Docker mode must not require a local config. When the local config path is not accessible:

ao uses the shadow directly as the effective config.
No sync is attempted.
ao can log: "No local config found at <path> — using global shadow config."
The system degrades gracefully to global-only mode when local configs are unavailable.

Blocked? No.

Edge case 10: Local config present, but global registry entry is missing
Scenario: User cloned a repo that has a committed agent-orchestrator.yaml. The project is not in their global registry yet.

What happens: ao start from that directory finds a local config but no registry entry. How does it register?

Resolution: ao start detects "local config exists, but no matching registry entry for this path" and auto-registers:

Reads local config to get behavior settings.
Prompts for a project ID (default: derived from directory name or git remote).
Creates the registry entry with the confirmed ID.
Syncs the shadow immediately.
This is the standard onboarding flow for "clone a repo and start ao."

Blocked? No.

Edge case 11: Mid-run config change — ao start is called while a session is running
Scenario: User runs ao start to sync a changed config while sessions are already active.

What happens: The shadow in global config is updated. Running sessions may now have different config than the shadow suggests.

Resolution: Running sessions do not reload config mid-run. Config is loaded at session start and frozen for the lifetime of that session. The shadow update affects only newly started sessions after the restart.

ao start should warn if sessions are already running: "Config will be updated in global registry but existing sessions will continue using their current config until restarted."

This is the same behavior expected of any service that reads config on start.

Blocked? No.

Edge case 12: Multiple machines — same project, different paths
Scenario: User works on the same project on two machines. On machine A, the project is at ~/projects/ao. On machine B, it is at ~/work/ao.

What happens: Each machine has its own global config with its own registry entry for the project. The paths differ. The local configs (if committed) are identical — the source of truth is the same.

Resolution: This is expected behavior. Global configs are machine-specific. The local config (committed to the repo) is the shared artifact. Each machine registers its own path. Shadow sync works independently per machine. No conflict.

If the user syncs their global config across machines via dotfiles: paths would need to be relative or templated. This is out of scope for v1.

Blocked? No.

Edge case 13: Shadow contains sensitive data
Scenario: Local config includes API keys, tokens, or other secrets in behavior fields. The shadow sync copies these into the global config.

What happens: Secrets are now in the global config file. If the global config is accidentally shared or committed, secrets leak.

Resolution:

ao must document clearly: do not put secrets in agent-orchestrator.yaml.
Secrets must use environment variables or a separate secrets file (not copied into shadow).
The shadow sync should explicitly exclude known secret-like fields (fields ending in Token, Key, Secret, Password) and warn if it detects potential secrets in local config.
A ao check-config command should warn about secrets in plain config.
Blocked? No, but requires explicit secrets hygiene policy and exclusion logic in sync.

Edge case 14: Local config is invalid YAML or fails schema validation
Scenario: User introduces a typo in local config. ao start is run.

What happens: ao cannot parse the local config. Shadow sync fails.

Resolution:

ao exits with a clear error pointing to the invalid field.
The global shadow is NOT updated (partial/corrupted shadow is worse than stale shadow).
The previous shadow remains in global config unchanged.
User fixes local config and re-runs ao start.
Blocked? No.

Edge case 15: Shadow sync is interrupted mid-write
Scenario: Machine crashes or process is killed during ao start while writing the shadow to global config.

What happens: Global config file may be partially written. Both the registry entry and shadow may be corrupt.

Resolution: Shadow write must be atomic:

Write to a temp file first.
Rename (atomic on POSIX) to replace the existing global config.
If the temp write fails, the existing global config is untouched.
This is a standard config-write safety pattern. No special ao-specific complexity.

Blocked? No.

Edge case 16: Project ID collision during registration
Scenario: User has two unrelated projects that would naturally get the same inferred ID (e.g., two repos both named api).

What happens: Auto-inferred ID from directory name collides with an existing registry entry.

Resolution: When ao detects an ID collision during ao start:

Warn the user: "ID api is already registered for a different project at <other-path>."
Prompt for an alternative ID.
Offer a default suggestion (e.g., api-2 or personal-api).
No silent overwrite. No silent rename.

Blocked? No.

Edge case 17: Behavior fields in global registry vs shadow — which wins?
Scenario: User manually edits the global config to change a behavior field (e.g., changes agent: claude-code to agent: opencode directly in the shadow). Then runs ao start in that project.

What happens: ao start syncs the local config into the global shadow, overwriting the manual edit.

Resolution: The local config is the source of truth. Manual edits to the shadow in global config are always overwritten on the next ao start. This is explicit and documented. Users who want to change behavior must change the local config, not the shadow.

This is a hard rule, not a preference.

Blocked? No. But must be documented prominently.

Edge case 18: Project registered but path does not exist yet
Scenario: User pre-registers a project before cloning its repo (e.g., preparing a new machine, or setting up a workspace before code is ready).

What happens: Global registry entry exists. Local config does not. ao start from the (not yet existing) path would fail or have nothing to read.

Resolution: Registration succeeds. The shadow entry is created with only the identity fields populated (name, path, id) and no behavior shadow. When ao start is later run from that path:

If local config exists (repo was cloned with committed config): sync proceeds normally.
If local config does not exist: ao scaffolds or prompts.
Pre-registration without a local config creates a partial registry entry. ao status marks such projects as "not started / config pending."

Blocked? No.

Config Loading Flow
The config loading path is deterministic and has three modes:

In-project mode (cwd matches a registered path)
Load global config (identity + shadow)
Match cwd to registered project path
Load local config from <path>/agent-orchestrator.yaml
If local config missing → fall back to shadow (shadow-fallback mode, show warning)
If local config invalid → error state; shadow is not used as fallback (invalid > stale)
Effective config = merged(global identity, local behavior)
Remote mode (ao spawn --project <id> from anywhere)
Load global config
Resolve project by ID
Use shadow behavior fields directly
No local config access required
ao start sync path
Load global config
Load local config
Validate local config (if invalid → abort, do not update shadow)
Write shadow atomically to global config under projects[id].*
Start daemon
Proposed Architecture
The target model has three layers — config, sessions, and surfaces — consumed by both the dashboard and the CLI.


                     Config
                       |
     Global registry (identity + shadow)  +  Per-project local configs (behavior)
       |                                        |
       |-- ao -> ~/projects/ao                  |-- ao/agent-orchestrator.yaml
       |     + shadow (synced on ao start)       |
       |-- ds -> ~/projects/ds                  |-- ds/agent-orchestrator.yaml
       |     + shadow (synced on ao start)       |
       '-- hl -> ~/projects/hl                  '-- hl/agent-orchestrator.yaml
                       |
                       v
                   Sessions
                       |
           ~/.agent-orchestrator/{hash}-{project}/sessions/
                       |
                       v
                  Surfaces
              +--------+---------+
              |                  |
           Dashboard             CLI
    /              portfolio   ao status     all projects
    /projects/ao   kanban      ao spawn      in-project or --project
    /sessions/ao-1 detail      ao send       by session (any dir)
                               ao session    list/kill/restore
The project page is not a new dashboard concept. It is the existing kanban dashboard, properly routed and scoped to one project. The portfolio page is a distinct project-summary view that sits above those project pages.

How config flows to each surface
Dashboard
Loads all project configs at startup. Reads display information (name, path, status) from the global registry only — it does not load local configs.

Portfolio page: display fields and session counts come from the global registry and session metadata. No local config required.
Project page: behavior display (e.g., configured agent) comes from the shadow. Shadow-stale state is not shown in the dashboard in v1 — it is a CLI/ao status concern.
Docker/remote deployments: dashboard works entirely from the global registry and shadows. No degraded state.
CLI
Loads config per-command. Two modes:

In-project mode (cwd matches a registered project path): loads local config for behavior (agent, runtime, permissions, tracker).
Remote mode (--project <id> from anywhere): uses shadow from global config for behavior. No local config access required.
Config Model
Global config
The global config is required.

Discovery order:

AO_CONFIG_PATH environment variable, if set
$XDG_CONFIG_HOME/agent-orchestrator/config.yaml (if XDG_CONFIG_HOME is set)
~/.agent-orchestrator/config.yaml (fallback when no XDG)
Data storage
Session data, worktrees, and archives follow the same convention:

If XDG_DATA_HOME is set → $XDG_DATA_HOME/agent-orchestrator/
If XDG_CONFIG_HOME is set but XDG_DATA_HOME is not → ~/.local/share/agent-orchestrator/
If no XDG → ~/.agent-orchestrator/ (config and data colocated)
The rule: respect XDG when the user has opted into it. Otherwise, keep everything in one place under ~/.agent-orchestrator/.

ao start requires this global config to exist. If it does not exist, ao start scaffolds it interactively.

The global config owns the project registry, shadow copies, and optional display order.


projects:
  ao:
    name: Agent Orchestrator
    path: ~/projects/agent-orchestrator
    _shadowSyncedAt: 1711580400
    # shadow behavior fields (synced from local on ao start):
    repo: org/agent-orchestrator
    agent: claude-code
    runtime: tmux
    workspace: worktree
    tracker: github
    agentConfig:
      permissions: auto-edit
      model: claude-sonnet-4-6
    reactions: [...]
    notifiers: [...]
  ds:
    name: Docs Server
    path: ~/projects/docs-server
    _shadowSyncedAt: 1711580300
    agent: opencode
    runtime: tmux
  hl:
    name: Homelab
    path: ~/projects/homelab
projectOrder: [ao, ds, hl]
Global operational settings
These settings are global by nature — they apply across all projects and live in the global config.

Setting	Purpose	Per-project?
port	Dashboard port (default: 3000)	No — one dashboard, one port
terminalPort, directTerminalPort	WebSocket server ports	No — one server, one port
readyThresholdMs	Time before "ready" becomes "idle" (default: 300s)	No — global for now
defaults	Default runtime, agent, workspace, notifiers. Projects inherit these when they don't specify their own.	No — this IS the cross-project defaults layer
notifiers	Notification channel configs (desktop, Slack, webhook)	Global default + per-project override
notificationRouting	Maps priority to notifier channels	Global default + per-project override
reactions	Auto-responses to events (agent-stuck, ci-failed, etc.)	Global default + per-project override (already supported)
The defaults block
The defaults block is actively used (46 references in the codebase). Every plugin resolution follows the pattern project.agent ?? config.defaults.agent. This means local configs are not fully self-contained — they inherit from global defaults when fields are omitted. This is intentional: it reduces repetition across projects while allowing per-project overrides.

Notification and reaction overrides
Notifiers and notification routing support per-project overrides. A project can route its urgent notifications to a different Slack channel than the global default. Reactions already support per-project overrides in the current code — project.reactions replaces the global reaction for that key.

Global config semantics
The map key (ao, ds, hl) is the canonical project ID.
name is display-only.
path points to the project root and is how the system discovers that project's local config.
projectOrder is optional. If present, it defines sidebar order and portfolio card order. If omitted, map insertion order is used.
The global config does not define project behavior from scratch — it stores identity fields and a shadow copy of behavior synced from local config on ao start. Manual edits to shadow fields are overwritten on the next sync.

Local project config
Each project keeps a local agent-orchestrator.yaml in its project root. This is the source of truth for project behavior.

Local config does not contain
name
path
sessionPrefix
project identity fields — these are owned by the global registry
Local config owns
repo / defaultBranch (note: repo should be auto-detected from git remote — see Local-Only Workflow)
agent / agentConfig
runtime / workspace
tracker / scm
reactions
notifiers / notificationRouting
orchestrator / worker
agentRules / orchestratorRules
session strategies
decomposer / postCreate / symlinks
Local config structure
The current local config wraps everything inside a projects map. With this architecture, the local config becomes a flat behavior-only file — no projects map, no identity fields.


# Current local config (single-project):
projects:
  agent-orchestrator:
    repo: org/agent-orchestrator
    path: ~/projects/agent-orchestrator
    sessionPrefix: ao
    agent: claude-code
    runtime: tmux
    ...
# New local config (behavior only):
repo: org/agent-orchestrator
agent: claude-code
runtime: tmux
workspace: worktree
...
Relationship between global and local configs
This architecture does not use an override/merge model.

the global config answers which projects exist and where they live (plus a shadow for remote access)
each local config answers how that specific project behaves
The relationship is:

Load the global config
Read the project registry from it
For a given project, load that project's local config from <project.path>/agent-orchestrator.yaml
Use the global config for identity, and the local config for behavior
If local config is unavailable, fall back to the shadow in the global config
These are separate domains, not layered overrides. The shadow is a convenience copy, not a competing source of truth.

Shadow schema (formal)
The shadow is stored inline under each project entry in the global config. Identity fields and shadow fields share the same namespace — they are distinguished by whether they are identity fields (fixed, not synced from local) or behavior fields (synced from local on ao start).


# ~/.agent-orchestrator/config.yaml
projects:
  ao:
    # Identity fields (never overwritten by shadow sync)
    name: Agent Orchestrator
    path: ~/projects/agent-orchestrator
    _shadowSyncedAt: 1711580400   # Unix timestamp of last successful sync
    # Shadow behavior fields (overwritten on every ao start)
    # Verbatim copy of the local config behavior section.
    # Stored and retrieved as an opaque map — no re-parsing.
    repo: org/agent-orchestrator
    agent: claude-code
    runtime: tmux
    workspace: worktree
    tracker: github
    agentConfig:
      permissions: auto-edit
      model: claude-sonnet-4-6
    reactions: [...]
    notifiers: [...]
Shadow schema rules
Identity fields (name, path) are fixed — shadow sync never overwrites them.
Behavior fields are passthrough — ao writes the entire local config behavior section verbatim. ao never re-parses or validates shadow fields when reading them back.
Fields matching *Token, *Key, *Secret, *Password (case-insensitive) are excluded from the shadow. ao prints a warning if such fields are found in the local config.
Unknown fields from newer ao versions are preserved in the shadow. ao never drops unknown fields during sync.
_shadowSyncedAt stores the Unix timestamp of the last successful shadow sync. Used by ao status to detect staleness.
The shadow stores only fields explicitly set in the local config. Fields inherited from global defaults are not stored in the shadow. At load time, the resolution order is: local config field > shadow field > global defaults. This means changing global defaults retroactively affects projects that did not explicitly override those fields.
How ao distinguishes identity from shadow
ao maintains a fixed list of identity field names: name, path. Everything else under a project entry (excluding internal fields prefixed with _) is treated as a shadow behavior field.

Shadow-fallback mode
When ao is run from a project directory and the local config is missing, ao enters shadow-fallback mode:

Effective config = global identity + shadow behavior fields
Warning shown: "Local config not found at <path> — using shadow. Run ao start after adding agent-orchestrator.yaml to sync."
Shadow-fallback state is visible in ao status output
ao does not update the shadow in this state
Registered project validity
A registered project is expected to have a local config at <project.path>/agent-orchestrator.yaml.

If a project is not in the global config, it is simply not registered.

If a project is registered but the local config file is missing or invalid, that project enters a degraded state — the shadow is still present for display and remote operations. Invalid registered projects still appear in the UI. They do not disappear just because their local config is missing or broken.

Defaults and repetition
The defaults block in the global config provides a cross-project defaults layer. Projects inherit from it when fields are omitted. Each local config can override specific fields; unset fields fall through to defaults. Schema-level defaults (runtime: "tmux", agent: "claude-code", etc.) still apply when a field is omitted entirely.

Failure Isolation
What happens when one project's config is broken?

Local config broken (one project)
If docs-server/agent-orchestrator.yaml has a syntax error:

Global config loads fine
All other projects work normally
ds enters error state — "invalid local config"
ao status still shows all projects; ds is marked errored
ao spawn --project ds falls back to the shadow in global config
ao spawn from within the docs-server directory fails (local config required for in-project mode)
Blast radius: one project for in-project operations. Remote operations (shadow-based) continue to work until the shadow is itself stale.

Global config broken
If the global config has a syntax error:

All projects are down — registry is unreadable
ao status fails
Shadow-based remote commands fail
Dashboard fails to start
Running agents are unaffected (already launched)
Blast radius: everything.

The isolation advantage: a broken local config only affects that one project for in-project operations. Remote operations still use the shadow. Local config failures are isolated; global config failures are catastrophic but affect a single file that is rarely edited by hand.

Project Identity
Project identity is owned by the global registry.

Canonical ID
The global project map key is the canonical project ID.

Used for	Example
Dashboard routes	/projects/ao
Session IDs	ao-1, ao-2
Session metadata ownership	project: "ao"
CLI filtering	--project ao
Sidebar and portfolio targeting	project card for ao
Identity does not come from local config
The local config does not define sessionPrefix, name, or path. These are owned by the global registry. Project identity is always resolved from the global registry entry.

Session ownership binding
When a session is created, its owning project ID is assigned from the resolved global registry entry — not from local config.

global registry says ao points to /home/harsh/projects/agent-orchestrator
project behavior is resolved from the local config (in-project mode) or the shadow (remote mode)
any session created for that project is owned by ao
therefore the session ID prefix and project binding come from the global registry key
Session Registry
Storage layout

# With XDG:
$XDG_DATA_HOME/agent-orchestrator/
  {hash}-{projectId}/
    sessions/
      ao-1
      ao-2
    worktrees/
# Without XDG:
~/.agent-orchestrator/
  config.yaml                    # config and data colocated
  {hash}-{projectId}/
    sessions/
    worktrees/
The {hash} is derived from sha256(project.path). This preserves backwards compatibility with existing single-project installs while supporting path-based isolation in the multi-project model.

The {projectId} suffix uses basename(project.path) for backwards compatibility. The global registry key (ao) is used for routing, session IDs, and UI — not for storage paths.

Session identity
Session IDs are globally unique. The global project ID is used as the prefix:

ao-1
ds-2
hl-4
Because they are globally unique, session detail routing can remain /sessions/[id]. No additional project segment is required.

Session metadata

interface SessionMetadata {
  id: string;
  project: string; // required -- canonical global project ID
  status: string;
  worktree: string;
  branch: string;
  // ... existing session fields
}
Listing behavior

list()        // all projects
list("ao")   // one project
ao status and session listing read only session metadata — they do not load local configs or shadow behavior to enumerate sessions. Session metadata stores project ID, session ID, status, and timing.

This means:

ao status works even when local configs are missing (Docker, broken config)
A project with a broken local config still shows in ao status with all sessions intact
The shadow is not consulted during listing
When a command acts on a session (e.g., ao session restore, ao session kill), it loads the shadow for that project's behavior config if not in in-project mode.

running.json
running.json in its current single-object form must be replaced. The single-project daemon state format does not fit the multi-project model. See §Implementation Risks for details.

Dashboard & Routing
The dashboard becomes a two-level information architecture: portfolio view and project view.

Route structure
Route	Purpose
/	Portfolio landing page
/projects/[id]	Project dashboard
/sessions/[id]	Session detail
Portfolio page
/ is the portfolio landing page. It is a project-summary view, not a session inbox.

It should
Reuse the shared dashboard shell and header
Keep the sidebar visible
Exclude project-specific actions from the portfolio header
Specifically not show the orchestrator button
Show project cards only in the main content area
Use whole-card click targets to enter project pages
Remain the landing page even if only one project is configured
It should not
Show a cross-project session list
Show session-level filtering/search
Show per-session triage content
Represent the Done section
Introduce session-row surfaces or recent-session lists
Portfolio page content
Each project card should show:

total sessions
counts for the canonical kanban buckets: Working, Pending, Review, Respond, Ready
Project cards should not include Done count, top issue sentence, or session rows.

Invalid registered projects should still appear here in a degraded state — the shadow is still present for display purposes.

Project page
/projects/[id] is the existing dashboard, scoped to one project. It preserves the current project-level mental model: kanban board, project-scoped session list/cards, PR table, Done section, project-scoped controls such as the orchestrator button.

If a project route resolves to a registered project that is in an error state (missing or invalid local config), the page should render an error state rather than pretending the project does not exist.

Sidebar
The sidebar is always visible. It is the primary persistent navigation surface for All Projects, configured projects, and lightweight project-level state indication.

The sidebar should not disappear just because there is only one configured project. Invalid registered projects should still appear in the sidebar in an error state.

Unknown project routes
Unknown /projects/[id] routes should return 404.

Real-time (SSE)
SSE events must carry the owning project ID:


interface SSEEvent {
  type: string;
  sessionId: string;
  projectId: string;
  data: unknown;
}
That allows the client to update the portfolio page's project summaries, update one project page only when scoped to /projects/[id], and keep session detail views connected to the right project context.

The event stream must be multi-project aware. The client filters events by projectId.

API
The web API is already mostly project-aware. Most endpoints accept projectId or resolve it from the session.

Endpoint	Project-aware?	Multi-project change needed
/api/sessions	Yes	Already supports project filtering
/api/spawn	Yes	Already takes projectId
/api/events (SSE)	Yes	Already has ?project= filter
/api/projects	Yes	Already returns all projects
/api/sessions/[id]/*	Yes	Resolves project from session
/api/issues	Yes	Project-scoped
/api/webhooks	Yes	Matches webhook path to project
/api/backlog	No	Needs project scoping — each project has its own repo and backlog
/api/prs/[id]/merge	Yes	Resolves from PR context
/api/orchestrators	Yes	Project-scoped
/api/verify	Yes	Takes project context
Only /api/backlog needs changes. All other endpoints are ready for multi-project.

CLI
The CLI aligns with the same project model as the dashboard.

ao status
ao status loads the global config to enumerate projects. It does not load or require local configs — it only reads session metadata from each project's session directory. This means ao status can show sessions for a project even when that project's local config is broken.

ao status does not register projects. If cwd is not a registered project directory, it does not error — it simply shows all registered projects.

Default behavior:

show all registered projects (regardless of any running dashboard's scope)
group sessions by project
include projects even when they currently have zero active sessions
Scoped: ao status --project <id> shows one project only.


$ ao status
Agent Orchestrator (ao)
  ao-1   working   ...
  ao-2   review    ...
Docs Server (ds)
  ERROR: local config missing (shadow available for remote commands)
Homelab (hl)
  no active sessions
This architecture does not require a separate ao projects command.

ao spawn
ao spawn has two modes that mirror the config loading model:

In-project mode (cwd matches a registered project path):


cd ~/projects/agent-orchestrator
ao spawn 123
# → resolves project from cwd
# → loads LOCAL config for behavior (agent, runtime, permissions, tracker)
Remote mode (--project <id> from anywhere):


ao spawn --project ao 123  # from ~/Desktop, CI, another project directory
# → resolves project from --project flag
# → loads SHADOW from global config for behavior
# → does NOT require local config to be accessible
# → does NOT require cwd to match project path
When local and shadow disagree: If the shadow is stale (local config was edited but ao start has not been run), remote spawn uses the stale shadow. In-project spawn uses the current local config. ao status shows a staleness warning.

Agent not installed: If the shadow specifies agent: claude-code but that agent is not installed, spawn fails with: "Agent claude-code not found. Install it or update the project config." This is not a config-strategy-specific problem.

Multi-project batch spawn:


# Spawn across three projects from anywhere
ao spawn --project ao 1
ao spawn --project api 2
ao spawn --project ds 3
Project resolution
When a command needs to resolve the current project from cwd:

Load global config
Match cwd against registered project.path entries
Match found → use registry key as project ID, load local config for behavior (fall back to shadow if local config unavailable)
No match → error: "project not registered. Run ao start first."
No command auto-registers projects. Registration is always explicit via ao start.

Commands without global config
ao start in a project dir with no global config → scaffold global config, register the project, proceed
Any other command with no global config → error: "no config found. Run ao start in a project directory."
Only ao start can scaffold and register. All other commands require an existing config.

ao start
requires the global config to exist, or scaffolds it interactively
uses port 3000 by default
allows an explicit port override when the user provides one
allows --projects to scope that dashboard instance to the listed registered projects
syncs the shadow from local config to global config on every start

ao start
ao start --port 3001
ao start --projects ao,ds
ao start --port 3001 --projects ao,ds
When --projects is used, the dashboard only sees the listed projects. The portfolio page shows only those project cards, the sidebar lists only those projects, and SSE events are scoped to those projects. Unscoped projects do not appear — they are simply not part of that dashboard instance's view.

The --projects flag is a display-only scope. The lifecycle manager polls all registered projects regardless of dashboard scope. SSE events fire for all projects. Sessions can be spawned for any registered project. The scope only affects which projects appear in the dashboard UI.

ao status is unaffected by any running dashboard's --projects scope. It always reads the full global registry.

Multiple dashboard instances on different ports are possible, but they are not a first-class managed workflow in this architecture.

Command-by-command analysis
Every CLI command and how it resolves config:

Command	Needs project behavior config?	In-project mode	Remote mode (--project <id>)
ao start	Yes — starts lifecycle workers per project	Load global registry, then load local config. Sync shadow.	N/A — always run from project dir
ao stop	No — just kills processes	Same in both modes. Reads running state, kills processes.	Same.
ao status	No — reads session metadata only	Reads global config for project list, reads metadata files for session state. Does not load local configs.	Same.
ao spawn	Yes — needs agent, runtime, permissions, model, etc.	Resolves project from cwd, loads local config for behavior.	Loads shadow from global config. Works from anywhere.
ao batch-spawn	Yes — same as spawn	Resolves from cwd.	Loads shadow from global config.
ao send	Partially — needs agent plugin to format message	Resolves agent from session metadata + local config.	Resolves agent from session metadata + shadow. Works from anywhere.
ao session ls	No — reads metadata only	Same in both modes. Already supports --project filter.	Same.
ao session kill	Yes — needs runtime + workspace plugin to destroy	Loads local config for the session's project to resolve plugins.	Resolves plugins from shadow. Works from anywhere.
ao session restore	Yes — needs agent plugin for restore command	Loads local config for agent/model/permissions.	Resolves from shadow. Works from anywhere.
ao session cleanup	Yes — needs SCM + workspace plugins	Loads local config per project to resolve plugins.	Resolves from shadow.
ao review-check	Yes — needs SCM plugin for PR review checks	Loads local config per project for SCM settings.	Resolves from shadow. Can check all projects without cd.
ao open	No — opens tmux sessions	Same in both modes. Reads session metadata for tmux target.	Same.
ao verify	Yes — needs tracker plugin	Loads local config for tracker settings.	Resolves from shadow.
ao dashboard	No — starts web server	Same in both modes. Reads global config for port and project list.	Same.
ao doctor	Yes — checks plugin availability	Checks local config for valid plugin references.	Checks shadow.
ao update	No	Same in both modes. Updates ao itself.	Same.
Pattern: Commands that need project behavior config (agent, runtime, SCM, tracker) use the local config in in-project mode and the shadow in remote mode. Commands that only read metadata (status, session ls, open, dashboard) behave identically regardless of mode.

CLI/project model alignment
global project map key is canonical
ao status --project <id> targets that project
ao spawn uses local config in-project, shadow remotely via --project <id>
dashboard scoping via ao start --projects ... uses project IDs from the global registry
Onboarding Experience
What happens from npm install -g @composio/ao to first spawned session.

First run

$ cd ~/projects/my-app
$ ao start
No ao config found.
? Set up ao for this project? (Y/n) Y
Creating config...
  -> Global: ~/.agent-orchestrator/config.yaml  (registry + shadow)
  -> Local:  ~/projects/my-app/agent-orchestrator.yaml  (source of truth)
? Project ID [my-app]: (press enter to accept or type a different ID)
? Which agent? (claude-code / codex / opencode / aider): claude-code
? Permissions mode? (default / auto-edit / permissionless): auto-edit
✓ Global config created (1 project registered)
✓ Local config created
✓ Shadow synced to global config
✓ Dashboard starting on http://localhost:3000
$ ao spawn 42
# Uses local config (in-project mode)
Spawning session my-app-1 for issue #42...
$ ao spawn --project my-app 43
# Uses shadow (remote mode — works from anywhere)
Spawning session my-app-2 for issue #43...
The local config can be committed to the repo. Teammates who clone get behavior config automatically — they only need ao start to register and sync the shadow.

Teammate workflow after cloning

$ cd ~/projects/my-app
$ ao start
# → local config found, project not registered
? Project ID [my-app]: (press enter to accept or type a different ID)
✓ Registered in global config
✓ Shadow synced
✓ Dashboard starting on http://localhost:3000
Behavior config came with the clone. ao start detects it and only asks for the project ID. One question instead of four.

Adding a second project

$ cd ~/projects/api-server
$ ao start
? Register this project? (Y/n) Y
? Project ID [api]: (press enter to accept or type a different ID)
? Which agent? claude-code
? Permissions? auto-edit
✓ Registered in global config
✓ Local config created
✓ Shadow synced
✓ Dashboard updated
$ ao spawn 15
Spawning api-1...
Docker deployment
In a shared Docker deployment, onboarding is drastically simpler:


# Admin sets up once:
docker compose up -d    # ao is running, global config is mounted
# Teammate onboarding:
# 1. Open browser
# 2. Go to http://ao.internal:3000
# 3. Done
No local install, no config files, no project registration. The config question becomes an ops concern (who maintains the Docker config), not a developer concern. The global config with shadows is self-sufficient — no local configs needed.

In Docker/headless mode, ao start is not used interactively. The operator pre-configures the global config with all project entries and shadow data. ao starts the daemon directly by reading the global config. No local config scaffolding or interactive prompts occur. If AO_NONINTERACTIVE=1 is set, ao start skips all prompts and uses the global config as-is.

Project Registration
Adding and removing projects is a core operation in the multi-project model. Today it means editing YAML by hand. This section defines the registration flow across CLI and dashboard.

Registration via ao start
Registration happens via ao start in the project directory. No dedicated ao add-project command is needed. See the Onboarding section for the full terminal flows for first run, second project, and clone-based onboarding.

Auto-detection
ao start should auto-detect:

repo — from git remote get-url origin
defaultBranch — from git symbolic-ref refs/remotes/origin/HEAD
scm — infer github or gitlab from remote URL
tracker — same as SCM if using GitHub/GitLab issues
name — from package.json, Cargo.toml, or directory name
id — suggest from directory name, user confirms or overrides
The fewer questions asked, the better the onboarding experience.

CLI: ao remove-project <id>

$ ao remove-project api
Project "api" has:
  2 active sessions (api-1, api-3)
  1 session in review (api-2)
  3 worktrees
? Kill active sessions and remove? (y/N) y
? Also delete worktrees? (y/N) n
✓ Killed 2 active sessions
✓ Removed "api" from config (shadow cleared)
  Worktrees preserved at ~/.agent-orchestrator/.../worktrees/
Must handle active sessions and worktrees explicitly. Never silently delete work. See Local-Only Workflow for worktree protection rules.

Dashboard: Portfolio page
Add project
Button on portfolio page: "+ Add Project"
Modal or form: enter path, ao scans and auto-detects settings
Same auto-detection as CLI (repo, branch, SCM, name)
User confirms or overrides detected values
Writes to global config (registry entry + shadow) and creates local config in project dir
Remove project
Per-project action in sidebar or project card
Confirmation dialog showing active sessions and worktrees
Options: kill sessions, preserve worktrees, archive metadata
Never one-click delete — always confirm with context
Dashboard: Project settings
Each project page could have a settings panel:

View and edit project config (agent, runtime, tracker, permissions)
Edits the local config file; shadow is updated on next ao start
Config changes take effect on next session spawn (not retroactive to running sessions)
Show detected vs overridden values (e.g., "repo: org/api-server (auto-detected)")
Summary
Surface	Add project	Remove project	Edit config
CLI	ao start in project dir	ao remove-project <id>	Manual YAML editing
Dashboard	"+ Add Project" on portfolio page (runs same registration flow)	Per-project remove action	Project settings panel
Priority	CLI + dashboard	CLI + dashboard	Dashboard
Implementation Risks
Architectural concerns identified by reviewing the current codebase against this proposal. These are not blockers — they are implementation details that an engineer will encounter during the build.

13.1 configPath is deeply embedded
The current architecture derives everything from configPath:

Storage hash: sha256(project.path) (decision: use project.path, not the old dirname(configPath) — this is a breaking change requiring the migration described in the Migration section)
Tmux session names: generateTmuxName(config.configPath, ...)
Worktree paths: derived from configPath-based storage dir
configPath is threaded through dozens of function signatures across session-manager.ts, paths.ts, lifecycle-manager.ts, and the CLI commands.

In the multi-project model, configPath changes meaning. The local config path still exists per project, but the global config path is also needed for the registry. The hash derivation uses sha256(project.path) — not the old sha256(dirname(configPath)). This solves the storage and tmux name collisions. This is a breaking change: existing storage directories use the old hash. The Migration section describes the symlink-based transition. The remaining work is threading this change through session-manager, paths, and CLI.

Other session-manager considerations
Local config loading: spawn() looks up config.projects[projectId]. All local configs must be loaded into config.projects at startup before session-manager is created.
Session enrichment timeout: list() enriches each session with a 2-second timeout. With many projects and many sessions, this becomes slow — may need parallel enrichment with a global timeout.
13.2 ao start as both setup wizard and daemon launcher
The doc proposes ao start handle first-run registration (scaffolding config, asking interactive questions) and daemon launching (starting dashboard + lifecycle workers). This overloads one command with two distinct responsibilities.

Risk: in non-interactive contexts (CI, Docker, systemd), ao start must not enter interactive mode. The command needs to detect whether it's running interactively and behave accordingly:

Interactive terminal + no config → scaffold interactively
Non-interactive (piped, Docker) + no config → error with clear message, don't prompt
Config exists → start daemon, never prompt
Alternatively, keep registration as a separate step (e.g., ao start errors without config, a first-run guide tells the user what to do). But this adds friction to the onboarding flow.

13.3 Session prefix = project ID (auto-derived)
The project ID is always auto-derived from basename(project.path) using the existing generateSessionPrefix logic. The user does not choose it.


~/projects/agent-orchestrator → "agent-orchestrator" → "ao"
~/projects/docs-server → "docs-server" → "ds"
~/projects/homelab → "homelab" → "hl"
~/projects/my-cool-api → "my-cool-api" → "mca"
This eliminates the session orphan problem entirely — the project ID and session prefix are always the same value, so existing sessions are always visible after migration. No user choice means no mismatch.

The tradeoff is that project IDs may be less readable (e.g., mca instead of a user-chosen api). This is acceptable — the name field in the global config provides the human-readable display name.

Collision handling
The derivation can produce collisions (e.g., agent-orchestrator, awesome-ops, and api-overhaul all derive to ao). On collision, ao start asks the user to pick a different ID:


$ cd ~/projects/awesome-ops
$ ao start
Derived project ID "ao" is already taken by Agent Orchestrator.
? Pick a different ID for this project: awops
✓ Registered as "awops"
Auto-derive by default. User only intervenes on collision.

13.4 running.json replacement
running.json in its current form is a single object tracking one dashboard PID, one lifecycle worker PID, and one port. This format is not compatible with multi-project — the multi-project model may need to track lifecycle state for multiple projects.

The current code depends on running.json for:

ao stop — finding and killing the dashboard + lifecycle worker
ao status — showing whether the dashboard is running and on which port
ao start — detecting if an instance is already running
The multi-project model needs a replacement that supports multiple projects. The exact format is out of scope for this doc — it intersects with the daemon/process model which is tracked separately. For this doc: running.json must be replaced, not simply removed.

13.5 Lifecycle worker model
The current code runs one lifecycle worker process per project via ao lifecycle-worker <project>, spawned by ao start. The multi-project model replaces this with a single process that polls all projects.

Current: N processes

ao start → spawns N processes:
  lifecycle-worker ao     (polls ao sessions every 30s)
  lifecycle-worker ds     (polls ds sessions every 30s)
  lifecycle-worker hl     (polls hl sessions every 30s)
Proposed: single process

ao start → one process:
  lifecycle-manager (polls ALL sessions every 30s)
    tick:
      Promise.allSettled([
        pollProject("ao"),   // async — succeeds
        pollProject("ds"),   // async — fails (logged, skipped)
        pollProject("hl"),   // async — succeeds
      ])
One timer, one tick, all projects polled concurrently via Promise.allSettled. Errors in one project are logged and skipped — other projects are unaffected. Same isolation as N processes, but in one process.

The existing createLifecycleManager already accepts an optional projectId — omitting it polls everything. The change is removing the per-project process spawning from ao start.

13.6 Orchestrator sessions
Currently ao start spawns one orchestrator session per project — an agent that manages and coordinates worker sessions. With multi-project, each registered project needs its own orchestrator.


ao start
  → dashboard (1 process)
  → lifecycle manager (1 process, polls all projects)
  → orchestrator for ao (tmux session)
  → orchestrator for ds (tmux session)
  → orchestrator for hl (tmux session)
This means N tmux sessions running N agents at startup. For 3 projects that's manageable. For 10+ projects, that's 10+ agents consuming tokens and context windows simultaneously.

Current approach: spawn an orchestrator for every registered project at ao start. This is consistent with the current single-project behavior scaled up.

Potential alternatives:

Lazy orchestrators — only spawn when a project has active sessions or pending issues
On-demand orchestrators — spawn per project via ao start --project ao, not all at once
Shared orchestrator — one orchestrator that manages sessions across all projects (fundamentally different model)
The per-project orchestrator model is the default. Better approaches welcome.

Migration
How existing single-project installs transition to multi-project. Migration is automatic — no manual steps required.

What the user sees

$ ao start
Detected single-project config format.
Migrating to multi-project...
  ✓ Created global config at ~/.agent-orchestrator/config.yaml
  ✓ Registered project "ao" (Agent Orchestrator)
  ✓ Migrated session storage (3 sessions preserved)
  ✓ Local config updated (identity fields removed)
  ✓ Shadow synced to global config
Migration complete. Starting dashboard...
What happens internally
ao start detects old-format config (has projects: map with inline identity + behavior)
Creates global config at ~/.agent-orchestrator/config.yaml with project registry extracted from old config
Rewrites local config to strip identity fields (name, path, sessionPrefix)
Syncs shadow from the updated local config into the global config
Switches storage hash derivation from configPath to project.path
Creates a symlink from old hash directory to new hash directory so existing sessions remain visible
Proceeds with normal ao start
Backwards compatibility
After migration, the old config format is no longer used. This is a one-way migration — the old format is not supported alongside the new format. If a user downgrades ao, the old config file still exists (migration doesn't delete it), but the global config won't be understood by older versions.

Edge cases
No existing sessions: Migration is just config rewrite. No storage changes needed.
Multiple projects in old config: All projects are registered in the global config. Each gets its own local config with identity fields removed.
Custom data directory: If custom paths were used, the symlink step must account for those.
Open Questions
Q1 Project management (post-registration)
Resolved:

Registration: via ao start in the project directory. No dedicated ao add-project.
ao projects command: not required. ao status shows all projects.
Onboarding flow: documented in the Onboarding section.
Config strategy: hybrid (local + shadow) is finalized. No further option comparison needed.
Remote CLI: --project <id> uses shadow, works from anywhere.
Also resolved:

ao remove-project <id>: Exists as described in the Project Registration section. It deletes the shadow and registry entry from global config. It does not delete the local config. Active sessions and worktrees are handled interactively (see the CLI flow in Project Registration).
Still open:

Project rename: Renaming a project ID (e.g., ao → orch) is destructive — it changes session ID prefixes, dashboard routes, the global registry key, and the shadow map key. This needs a dedicated spec before implementation.
Dashboard project management UI: Add/remove/settings in the dashboard is a UX decision, not an architecture blocker.
Q2 ao start behavior
Resolved:

Missing global config: scaffold interactively
In registered dir with local config: sync shadow, start daemon
In unregistered dir with local config: prompt for ID, register, sync shadow, start daemon
In dir with no local config: scaffold local config, then register and sync
--sync-only flag (v2+): sync shadow only, no daemon restart
Still open:

Does ao start accept --port? Does it override the global config port?
Does ao start --projects a,b,c restrict which projects are loaded, or is it a display filter only?
Detailed interactive scaffolding UX (question order, defaults) — design separately
On this page
Problem Statement
Concrete pain points today
Current Architecture
Config loading
Config ownership
Session storage
Dashboard behavior
Config Strategy: Hybrid (local + shadow)
How it works
Sync rules
Design rationale
Edge Case Analysis
Edge case 1: Local config is edited between two ao start calls
Edge case 2: Local config is deleted after registration
Edge case 3: Project path changes (directory moved or renamed)
Edge case 4: Two projects share the same path
Edge case 5: Shadow diverges from local config after a teammate pushes changes
Edge case 6: Global config is deleted or corrupted
Edge case 7: Local config has fields that are not in the shadow schema
Edge case 8: ao start in a directory with no registered project
Edge case 9: Docker deployment with no local configs
Edge case 10: Local config present, but global registry entry is missing
Edge case 11: Mid-run config change — ao start is called while a session is running
Edge case 12: Multiple machines — same project, different paths
Edge case 13: Shadow contains sensitive data
Edge case 14: Local config is invalid YAML or fails schema validation
Edge case 15: Shadow sync is interrupted mid-write
Edge case 16: Project ID collision during registration
Edge case 17: Behavior fields in global registry vs shadow — which wins?
Edge case 18: Project registered but path does not exist yet
Config Loading Flow
In-project mode (cwd matches a registered path)
Remote mode (ao spawn --project <id> from anywhere)
ao start sync path
Proposed Architecture
How config flows to each surface
Dashboard
CLI
Config Model
Global config
Data storage
Global operational settings
The defaults block
Notification and reaction overrides
Global config semantics
Local project config
Local config does not contain
Local config owns
Local config structure
Relationship between global and local configs
Shadow schema (formal)
Shadow schema rules
How ao distinguishes identity from shadow
Shadow-fallback mode
Registered project validity
Defaults and repetition
Failure Isolation
Local config broken (one project)
Global config broken
Project Identity
Canonical ID
Identity does not come from local config
Session ownership binding
Session Registry
Storage layout
Session identity
Session metadata
Listing behavior
running.json
Dashboard & Routing
Route structure
Portfolio page
It should
It should not
Portfolio page content
Project page
Sidebar
Unknown project routes
Real-time (SSE)
API
CLI
ao status
ao spawn
Project resolution
Commands without global config
ao start
Command-by-command analysis
CLI/project model alignment
Onboarding Experience
First run
Teammate workflow after cloning
Adding a second project
Docker deployment
Project Registration
Registration via ao start
Auto-detection
CLI: ao remove-project <id>
Dashboard: Portfolio page
Add project
Remove project
Dashboard: Project settings
Summary
Implementation Risks
13.1 configPath is deeply embedded
Other session-manager considerations
13.2 ao start as both setup wizard and daemon launcher
13.3 Session prefix = project ID (auto-derived)
Collision handling
13.4 running.json replacement
13.5 Lifecycle worker model
Current: N processes
Proposed: single process
13.6 Orchestrator sessions
Migration
What the user sees
What happens internally
Backwards compatibility
Edge cases
Open Questions
Q1 Project management (post-registration)
Q2 ao start behavior
