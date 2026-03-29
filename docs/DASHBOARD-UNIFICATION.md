# Dashboard Unification — Implementation Summary

**Branch:** `ashish/feat/dashboard-unification`
**Date:** 2026-03-29

## What Changed

This branch transforms Agent Orchestrator from a single-project tool into a
multi-project portfolio platform. The changes span config architecture, session
management, dashboard UI, and CLI.

## 1. Hybrid Config Architecture

**Before:** One `agent-orchestrator.yaml` per project containing both identity
(name, path, sessionPrefix) and behavior (agent, runtime, tracker).

**After:** Two-tier model.

**Global config** (`~/.agent-orchestrator/config.yaml`):
- Project registry (name, path per project)
- Shadow copies of behavior fields (synced from local on `ao start`)
- Global operational settings (port, defaults, notifiers, reactions)

**Local config** (`<project>/agent-orchestrator.yaml`):
- Behavior fields only (repo, agent, runtime, workspace, tracker)
- No identity fields (those live in global registry)
- Flat YAML, no `projects:` wrapper

**Key files:**
- `packages/core/src/global-config.ts` — global config load/save/sync/migrate
- `packages/core/src/config.ts` — `findConfigFile()` skips flat local configs

**Migration:** `migrateToGlobalConfig()` automatically converts old format on
`ao start`. Prompts user for confirmation. One-way migration.

## 2. Session Directory Hashing

**Before:** `generateInstanceId()` hashed `dirname(configPath)` to create session
directory names. When config moved from local to global, the hash changed,
making existing sessions invisible.

**After:** `generateInstanceId()` uses `generateProjectHash(projectPath)` — the
hash is derived from the project directory path, which never changes regardless
of config location.

- `8daddfbd4e08` = hash of `/Users/.../agent-orchestrator` (stable)
- Sessions always found at `~/.agent-orchestrator/8daddfbd4e08-agent-orchestrator/sessions/`

**Key file:** `packages/core/src/paths.ts`

## 3. Portfolio Discovery

Projects are discovered from three sources, merged by `getPortfolio()`:

1. **Auto-discovery:** Scans `~/.agent-orchestrator/` for `{hash}-{projectId}/`
   directories with `.origin` files
2. **Explicit registration:** `registered.json` from `ao project add` or
   dashboard modals
3. **Preferences overlay:** `preferences.json` for pinning, ordering, enable/disable

Degraded directories (stale test artifacts with no valid config) are filtered
out to keep the sidebar clean.

When `.origin` points to a flat local config (post-migration), discovery falls
back to the global config for project metadata while keeping the original
configPath for hash stability.

**Key file:** `packages/core/src/portfolio-registry.ts`

## 4. Dashboard Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `PortfolioPage` | Attention-first home (returning users) or launcher (new users) |
| `/projects/[id]` | `Dashboard` | Project-scoped kanban board |
| `/activity` | `ActivityFeedPage` | Cross-project session feed |
| `/settings` | Settings page | Portfolio config, agent defaults, integrations |
| `/projects/[id]/sessions/[id]` | Session detail | Individual session view |

## 5. Portfolio Home (`/`)

Conditionally renders based on user state:

- **Has projects with sessions:** Shows attention summary with per-project cards
  displaying active/total counts and attention level breakdown (merge, respond,
  review, pending, working)
- **New user / no sessions:** Shows launcher cards (Open project, Clone from URL,
  Quick start)

**Key file:** `packages/web/src/components/PortfolioPage.tsx`

## 6. Unified Sidebar

Persistent left rail on desktop, drawer on mobile. Shows:

- "Activity" link to cross-project feed
- "Workspaces" section with project list
- Filter/group controls (by status or repo)
- Add menu (Open project, Clone from URL, Quick start)
- Per-project hover actions (resources modal, spawn agent, remove)

**Key file:** `packages/web/src/components/UnifiedSidebar.tsx`

## 7. Onboarding Modals

Three modal flows accessible from both the home page and sidebar:

- **AddProjectModal** — Browse filesystem, select directory, register
- **CloneFromUrlModal** — Enter git URL + location, clone and register
- **QuickStartModal** — Name + location + template (Empty/Next.js), scaffold and register

## 8. Activity Feed (`/activity`)

Cross-project session view grouped by status (respond, review, pending,
working, done). Searchable by workspace name, session ID, branch, PR, issue.

**Key file:** `packages/web/src/components/ActivityFeedPage.tsx`

## 9. Settings (`/settings`)

Portfolio-level configuration:
- **Projects & Repos** — enable/disable, pin, remove projects
- **Agent Defaults** — default agent, permissions, workspace strategy
- **Integrations** — GitHub, Linear, Slack, OpenClaw

**Key files:** `packages/web/src/app/settings/page.tsx`,
`packages/web/src/components/settings/*.tsx`

## 10. New API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/projects` | GET/POST | List or register projects |
| `/api/projects/[id]` | DELETE | Remove project |
| `/api/projects/clone` | POST | Clone repo and register |
| `/api/projects/quick-start` | POST | Scaffold and register |
| `/api/projects/[id]/resources` | GET | PRs/branches/issues for workspace modal |
| `/api/browse-directory` | GET | Filesystem browser for AddProjectModal |
| `/api/settings/preferences` | POST | Save portfolio preferences |
| `/api/integrations` | GET | List available integrations |

## 11. Design System

All branch components aligned with DESIGN.md from main:
- **Typography:** Geist Sans (body), JetBrains Mono (data/code)
- **Accent:** #5B7EF8
- **Border radius:** 2px base, 4px sm, 8px lg
- **Surfaces:** Dark (#0a0d12 base) and light (#f5f5f7 base) modes

## User Flows

### New User
```
ao start → creates global + local config → dashboard at localhost:3000
         → portfolio home with launcher cards
         → add more projects via sidebar or CLI
```

### Existing User (upgrading)
```
ao start → detects old config format → prompts migration
         → rewrites local to flat, creates global with shadow
         → sessions remain visible (hash based on project path)
         → dashboard shows portfolio with all sessions
```

### Adding a Second Project
```
cd ~/other-project && ao start
  → auto-registers in global config
  → syncs shadow
  → appears in sidebar immediately
```

## Files Changed

- **Core:** 15 files (config, paths, portfolio registry, session manager, types)
- **CLI:** 8 files (start, spawn, status, project commands)
- **Web:** 50+ files (routes, components, API endpoints, libs)
- **Plugins:** Discord notifier, OpenClaw notifier
- **Total:** ~145 files, +22K/-7K lines
