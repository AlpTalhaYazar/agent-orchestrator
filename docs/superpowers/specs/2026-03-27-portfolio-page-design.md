# Portfolio Page — Design Spec

## Overview

The portfolio page is the home surface at `/` for Agent Orchestrator.

It is the default landing experience for users with one project or many projects. It renders inside `DashboardShell`, with `UnifiedSidebar` as the persistent left rail on desktop and an off-canvas drawer on mobile.

The page has two jobs:

1. Give the user a calm portfolio-level entry point.
2. Let the user immediately do one of three things:
   - open a project
   - clone a repository
   - quick-start a new project

This is not a second dashboard. It is the home surface for the product.

## Product stance

### Portfolio-first for everyone

All users, including users with exactly one project, land on the same home surface at `/`.

- A one-project user still sees:
  - the left sidebar
  - their single workspace in the sidebar
  - the same main portfolio/home page content
- `Open project` simply takes them into their only project.
- The footer/count copy should still make sense for one project, for example `1/1 workspaces available`.

This avoids branching home behavior by project count and keeps the product model consistent.

## Architecture

### Routing

- **Home route:** `/`
  - Renders `DashboardShell > PortfolioPage`
- **Project route:** `/projects/[id]`
  - Renders `DashboardShell > Dashboard`
- **Legacy portfolio route:** `/portfolio`
  - Redirects to `/` if retained for compatibility

There is no `/?project=<id>` navigation model in the target design.

### Shared shell

All top-level web surfaces share the same shell:

```text
DashboardShell
├── UnifiedSidebar
└── Main content
    ├── PortfolioPage at /
    └── Dashboard at /projects/[id]
```

`DashboardShell` is responsible for:

- rendering `UnifiedSidebar`
- mobile drawer behavior
- shared modal plumbing for:
  - add local project
  - clone from URL
  - quick start

### Data loading

Portfolio/home data should be loaded on the server and passed into `PortfolioPage`.

Use the existing portfolio services layer:

1. `getPortfolioServices()` for the project list
2. `getCachedPortfolioSessions()` for session snapshots
3. aggregate per-project counts using `getAttentionLevel()`

If useful, extract this logic into `lib/portfolio-page-data.ts`. That extraction is a cleanup refactor, not a required architectural invention.

```typescript
interface PortfolioPageData {
  projects: PortfolioProjectSummary[];
  defaultLocation: string;
}

interface PortfolioProjectSummary {
  id: string;
  name: string;
  sessionCount: number;
  activeCount: number;
  attentionCounts: Record<AttentionLevel, number>;
  degraded: boolean;
  degradedReason?: string;
}
```

`PortfolioProjectSummary` lives in `lib/types.ts`.

## UX model

### Desktop

- `UnifiedSidebar` remains visible on the left
- `PortfolioPage` renders in the main content region
- the portfolio content is visually calm and intentionally sparse
- the page should feel like a launcher/home, not a dense operations board

### Mobile

- sidebar becomes a drawer
- portfolio content becomes full-width
- action cards remain easily tappable
- modal flows should feel native on narrow screens

### Empty state

If there are zero projects:

- the main content becomes a getting-started state
- onboarding actions are still visible and prominent
- there are no project cards or project summaries

## Portfolio page layout

The current design direction is launcher-first, not grid-of-project-cards first.

### Required content

- brand/title lockup
- `Open project`
- `Clone from URL`
- `Quick start`
- minimal supporting count/status copy

### Not required on the home surface

- cross-project action queue
- project summary card grid
- dashboard-style filters
- dense health overviews

Those may exist later, but they are not required for the primary home experience.

## Sidebar design

`UnifiedSidebar` is part of the portfolio experience, not a separate concern.

### Desktop sidebar structure

- top row:
  - `Activity` link
- section header:
  - `Workspaces`
  - filter icon
  - add-repository icon
- filter card:
  - `Group by`
  - second contextual selector
- workspace list
- bottom utility icons

### Sidebar filters

The sidebar owns the workspace filtering UI.

#### Group by

Allowed values:

- `Repo`
- `Status`

#### Secondary filter

If grouped by `Repo`:

- `All repos`
- individual repo selection from registered projects

If grouped by `Status`:

- `All statuses`
- `Active`
- `Review`
- `Respond`
- `Quiet`

#### Interaction requirements

- custom dropdown/popover UI, not default browser select styling
- clicking outside the active dropdown closes it
- only one dropdown is open at a time
- closed state must fit inside the sidebar width without overflow
- open popovers may be wider than the closed trigger if needed

### Add repository menu

The add-repository control in the sidebar opens a menu with:

- `Open project`
- `Clone from URL`
- `Quick start`

These actions should reuse the same modal flows used by the home page.

## Onboarding flows

### Open project

Registers an existing local git repository into the portfolio.

- uses `AddProjectModal`
- validates local path
- validates git repository
- registers project

### Clone from URL

Clones a git repository locally, registers it, then navigates to `/projects/<id>`.

- modal fields:
  - `Git URL`
  - `Clone location`
- action:
  - run `git clone`
  - register the resulting repo
  - redirect to `/projects/<id>`

### Quick start

Creates a local project, initializes git, registers it, then navigates to `/projects/<id>`.

- modal fields:
  - `Name`
  - `Location`
  - `Template`
- initial supported templates:
  - `Empty`
  - `Next.js`

The initial `Next.js` quick start may scaffold the files without automatically running install. That is acceptable for the first version as long as the behavior is explicit.

## Modal behavior

Use the shared modal system.

### Required behavior

- desktop:
  - centered modal surface
- mobile:
  - bottom-sheet style presentation or equivalent responsive modal treatment
- shared flows should work from:
  - home page action cards
  - sidebar add-repository menu

If `Modal.tsx` must be upgraded to support responsive desktop vs mobile presentation, that is an explicit implementation task, not an implicit assumption.

## Styling

All styling should use the existing design system and tokens.

- IBM Plex Sans for primary text
- IBM Plex Mono for small labels where appropriate
- CSS variable tokens for backgrounds, text, borders, accents
- project swatches defined as CSS custom properties in `globals.css`
- no hardcoded component-level hex colors for recurring design system values

### Design character

- calm
- minimal
- intentional
- portfolio-first
- not a generic SaaS admin board

## Implementation plan

### Already exists and should be reused

- `components/DashboardShell.tsx`
- `components/UnifiedSidebar.tsx`
- `components/PortfolioPage.tsx`
- `components/CloneFromUrlModal.tsx`
- `components/QuickStartModal.tsx`
- `components/AddProjectModal.tsx`
- `components/Modal.tsx`
- `app/page.tsx`
- `app/projects/[id]/page.tsx`
- `app/api/projects/clone/route.ts`
- `app/api/projects/quick-start/route.ts`
- portfolio services and aggregation helpers

### Modify

- `app/page.tsx`
  - ensure home renders the final portfolio page data and shell
- `components/PortfolioPage.tsx`
  - keep this as the launcher-style home surface
- `components/UnifiedSidebar.tsx`
  - finalize sidebar layout, filters, add menu, and interactions
- `components/DashboardShell.tsx`
  - keep shared modal wiring for sidebar actions
- `components/Modal.tsx`
  - if needed, add proper responsive mobile presentation
- `app/globals.css`
  - token and style support for portfolio/sidebar polish

### Optional refactor

- `lib/portfolio-page-data.ts`
  - extract server aggregation logic from `app/page.tsx` if it improves clarity

### Compatibility route

- `app/portfolio/page.tsx`
  - optional redirect to `/`

## Out of scope

- real-time SSE updates on the home surface
- cross-project action queue on the home surface
- project pinning or manual reordering
- portfolio preferences UI
- major redesign of the per-project dashboard itself

## Definition of done

The portfolio/home work is done when:

1. `/` is the portfolio-first home surface
2. `/projects/[id]` remains the per-project dashboard route
3. the sidebar is the persistent workspace control surface on desktop
4. `Open project`, `Clone from URL`, and `Quick start` work from the home surface
5. the same project actions also work from the sidebar add menu
6. single-project users still get the same coherent home experience
7. the final UI feels calm and intentional rather than dashboard-heavy
