# Refactoring Improvements Roadmap — `packages/core/`

## Critical Refactors

### Refactor: Decompose `session-manager.ts` into focused modules
- **Location**: `packages/core/src/session-manager.ts` (entire file, ~1400 lines)
- **Problem**: The entire session manager is a single `createSessionManager()` closure containing 30+ inner functions. This makes individual behaviors impossible to unit test, creates a mental load barrier for contributors, and causes merge conflicts when multiple people touch the file. The OpenCode-specific logic (~200 lines) is interleaved throughout, breaking the agent-agnostic abstraction.
- **Impact**: This is the most critical file in the core package — every CLI command, dashboard action, and lifecycle event flows through it. Its current structure makes it the #1 source of accidental complexity.
- **Suggested Approach**:
  1. Extract OpenCode-specific functions into `opencode-helpers.ts` (already partially done for tests): `deleteOpenCodeSession`, `fetchOpenCodeSessionList`, `discoverOpenCodeSessionIdsByTitle`, `resolveOpenCodeSessionReuse`, `findOpenCodeSessionIds`. These are pure functions that don't need closure state.
  2. Extract session identity management into `session-identity.ts`: `getNextSessionNumber`, `getSessionNumber`, `escapeRegex`, `reserveNextSessionIdentity`, `listRemoteSessionNumbers`, `listArchivedSessionIds`, `sortSessionIdsForReuse`.
  3. Extract metadata repair logic into `metadata-repair.ts`: `repairSingleSessionMetadataOnRead`, `repairSessionMetadataOnRead`, `updateMetadataPreservingMtime`, `applyMetadataUpdatesToRaw`, `sessionMetadataTimestamp`.
  4. Extract enrichment logic into `session-enrichment.ts`: `ensureHandleAndEnrich`, `enrichSessionWithRuntimeState`, `ensureOpenCodeSessionMapping`.
  5. Keep `createSessionManager()` as a thin orchestration layer that wires these modules together.

### Refactor: Break down `lifecycle-manager.ts` `determineStatus()`
- **Location**: `packages/core/src/lifecycle-manager.ts:213-365`
- **Problem**: The `determineStatus()` function is a 150-line branching maze with ~25 cyclomatic complexity. It threads a `detectedIdleTimestamp` variable across 5 sequential sections, making the control flow extremely hard to follow. Bug reports in status determination require reading the entire function to understand which branch fired.
- **Impact**: Status determination is the heartbeat of the orchestrator. Bugs here cause sessions to get stuck, miss transitions, or trigger wrong reactions. The current structure makes it very hard to add new status transitions safely.
- **Suggested Approach**:
  1. Extract each section into a named function with a clear signature:
     ```typescript
     async function checkRuntimeAlive(session, plugins): Promise<"killed" | null>
     async function detectAgentActivity(session, agent, runtime): Promise<{ status: SessionStatus | null; idleTimestamp: Date | null }>
     async function autoDetectPR(session, scm, project): Promise<void>
     async function checkPRState(session, scm): Promise<SessionStatus | null>
     function checkStuckThreshold(session, idleTimestamp, config): SessionStatus | null
     ```
  2. Have `determineStatus()` call these in sequence, returning early when a function returns a definitive status.
  3. Similarly extract `maybeDispatchReviewBacklog()` (lines 535-684) into a separate file — it's an independent concern (review comment tracking) that happens to run after status determination.

### Refactor: Migrate `metadata.ts` to async I/O
- **Location**: `packages/core/src/metadata.ts` (entire file)
- **Problem**: All metadata operations use synchronous `readFileSync`/`writeFileSync`/`statSync`/`readdirSync`. The `list()` path calls `statSync` for every session file. During lifecycle polling (every 30s), this blocks the Node.js event loop for the duration of all filesystem operations. On a project with 50+ sessions, this can cause measurable latency spikes on the dashboard SSE stream and API responses.
- **Impact**: As the system scales to more projects and sessions, synchronous I/O becomes a bottleneck. Dashboard responsiveness degrades, and lifecycle poll cycles take longer.
- **Suggested Approach**:
  1. Create async versions of all functions: `readMetadataAsync`, `writeMetadataAsync`, `updateMetadataAsync`, `listMetadataAsync`.
  2. Use `fs/promises` for `readFile`, `writeFile`, `readdir`, `stat`.
  3. Update `atomicWriteFileSync` to have an async counterpart `atomicWriteFile`.
  4. Migrate callers incrementally — start with `lifecycle-manager.ts` and `session-manager.ts` list/get paths.
  5. Keep sync versions for CLI commands where blocking is acceptable (e.g., `ao session ls` is a short-lived process).

## Medium Priority Improvements

### Refactor: Deduplicate recovery module
- **Location**: `packages/core/src/recovery/manager.ts` and `packages/core/src/recovery/actions.ts`
- **Problem**: `runRecovery` and `recoverSessionById` share ~80% of their logic. The switch statements for dry-run vs actual execution in `runRecovery` are nearly identical. In `actions.ts`, all three action functions (`recoverSession`, `cleanupSession`, `escalateSession`) follow the exact same try/catch pattern.
- **Impact**: Any change to recovery behavior must be made in multiple places, increasing the chance of inconsistency.
- **Suggested Approach**:
  1. Extract a `processAssessment(assessment, config, registry, context, report)` function that handles both dry-run and actual execution, updating the report as it goes.
  2. In `actions.ts`, extract a `withRecoveryErrorHandling(sessionId, action, fn)` higher-order function that wraps the common try/catch/return-error pattern.
  3. Have `recoverSessionById` call `processAssessment` directly instead of duplicating the orchestration logic.

### Refactor: Eliminate duplicate `expandHome`
- **Location**: `packages/core/src/config.ts:206-211` and `packages/core/src/paths.ts:179-184`
- **Problem**: Identical `expandHome()` implementations exist in both files. `config.ts` already imports from `paths.ts` for other utilities but defines its own `expandHome`.
- **Impact**: Low — but it's a maintenance hazard. If the logic needs to change (e.g., Windows support), it must be updated in both places.
- **Suggested Approach**: Delete `expandHome` from `config.ts` and import it from `paths.ts`. The function is already exported from `paths.ts` and re-exported from `index.ts`.

### Refactor: Add proper error reporting to `loadBuiltins`
- **Location**: `packages/core/src/plugin-registry.ts:112-124`
- **Problem**: `loadBuiltins` catches ALL errors during plugin loading with an empty catch block. This includes genuine errors like broken plugin code, missing peer dependencies, or misconfigured plugin factories. When a plugin silently fails to load, the system continues with degraded functionality and the root cause is invisible.
- **Impact**: Debugging "plugin not found" errors in the lifecycle manager or session manager requires tracing back to a swallowed exception in the registry. This wastes developer time.
- **Suggested Approach**:
  ```typescript
  try {
    const mod = (await doImport(builtin.pkg)) as PluginModule;
    if (mod.manifest && typeof mod.create === "function") {
      this.register(mod, pluginConfig);
    }
  } catch (err) {
    // Only swallow MODULE_NOT_FOUND — report everything else
    if (isModuleNotFoundError(err, builtin.pkg)) continue;
    console.warn(`[plugin-registry] Failed to load ${builtin.pkg}: ${err}`);
  }
  ```
  Where `isModuleNotFoundError` checks `err.code === 'MODULE_NOT_FOUND'` or `err.code === 'ERR_MODULE_NOT_FOUND'` and the specifier matches the expected package.

### Refactor: Reduce `observability.ts` I/O overhead
- **Location**: `packages/core/src/observability.ts:307-331` (the `updateSnapshot` helper)
- **Problem**: Every `recordOperation()` and `setHealth()` call does a full read-parse-modify-write cycle on a JSON file. With lifecycle polling every 30s and multiple sessions, this is a lot of disk I/O for what is essentially append-only data.
- **Impact**: Adds unnecessary latency to lifecycle polling and risks corrupted files if multiple processes write concurrently (despite atomic rename, there's a read-modify-write race).
- **Suggested Approach**:
  1. Buffer writes in memory and flush periodically (e.g., every 5 seconds or on process exit).
  2. Or switch to append-only JSONL format for traces (read-modify-write is then only needed for metrics/health counters, which change less frequently).
  3. Add a `flush()` method to the `ProjectObserver` interface so callers can force a write when needed (e.g., before process exit).

### Refactor: Strengthen `safeJsonParse` type safety
- **Location**: `packages/core/src/utils/validation.ts:28-34`
- **Problem**: `safeJsonParse<T>` returns `JSON.parse(str) as T` without any runtime validation. Callers get a `T | null` where the `T` case may not actually conform to the expected shape.
- **Impact**: When metadata files contain corrupted or unexpected data (common after crashes), the parsed value silently doesn't match the expected type, causing runtime errors in unexpected places.
- **Suggested Approach**: For the primary use case (`RuntimeHandle`), add a validation function:
  ```typescript
  export function safeJsonParse<T>(str: string, validate?: (v: unknown) => v is T): T | null {
    try {
      const parsed: unknown = JSON.parse(str);
      if (validate && !validate(parsed)) return null;
      return parsed as T;
    } catch {
      return null;
    }
  }
  ```

### Refactor: Clean up `classifySession` overlapping branches
- **Location**: `packages/core/src/recovery/validator.ts:116-146`
- **Problem**: The `classifySession` function has overlapping conditions. The check `if (runtimeAlive && workspaceExists && !agentProcessRunning)` on line 141 is unreachable because it's already covered by the negation of the first check on line 122. The final `return "partial"` on line 145 is dead code.
- **Impact**: Makes the classification logic harder to verify and audit. New contributors may add conditions in the wrong place.
- **Suggested Approach**: Restructure as a decision matrix:
  ```typescript
  function classifySession(...): RecoveryClassification {
    if (TERMINAL_STATUSES_SET.has(metadataStatus) && !runtimeAlive && !workspaceExists) {
      return "unrecoverable";
    }
    if (runtimeAlive && workspaceExists && agentProcessRunning) return "live";
    if (!runtimeAlive && !workspaceExists) return "dead";
    if (!runtimeAlive && workspaceExists) return "dead";
    return "partial"; // Any other combination
  }
  ```

## Nice-to-Have Enhancements

### Enhancement: Extract `applyDefaultReactions` config to a separate file
- **Location**: `packages/core/src/config.ts:310-381`
- **Problem**: The default reaction configuration is a large hardcoded object embedded in the config loader. It mixes configuration policy with config parsing mechanics.
- **Benefit**: Separating default reactions into `default-reactions.ts` makes them easier to review, document, and override. It also reduces the cognitive load when reading the config loader.
- **Suggested Approach**: Move the `defaults` object to a new `default-reactions.ts` file, export it as `DEFAULT_REACTIONS`, and import it in `config.ts`.

### Enhancement: Replace IIFE in `session-from-metadata.ts`
- **Location**: `packages/core/src/utils/session-from-metadata.ts:27-41`
- **Problem**: The `pr` field uses an immediately-invoked function expression inside the return object literal. This is harder to read and debug than a simple helper function call.
- **Benefit**: Improved readability.
- **Suggested Approach**: Extract to a named function:
  ```typescript
  function parsePrFromMetadata(meta: Record<string, string>): PRInfo | null {
    const prUrl = meta["pr"];
    if (!prUrl) return null;
    const parsed = parsePrFromUrl(prUrl);
    return {
      number: parsed?.number ?? 0,
      url: prUrl,
      title: "",
      owner: parsed?.owner ?? "",
      repo: parsed?.repo ?? "",
      branch: meta["branch"] ?? "",
      baseBranch: "",
      isDraft: false,
    };
  }
  ```

### Enhancement: Remove unused import in `lifecycle-manager.ts`
- **Location**: `packages/core/src/lifecycle-manager.ts:34`
- **Problem**: `type ProjectConfig as _ProjectConfig` is imported but never used anywhere in the file. The underscore prefix is there specifically to suppress the unused variable warning.
- **Benefit**: Cleaner imports, no lint suppression needed.
- **Suggested Approach**: Remove the import line.

### Enhancement: Cache `git ls-remote` results in `reserveNextSessionIdentity`
- **Location**: `packages/core/src/session-manager.ts:630-660` (`listRemoteSessionNumbers`)
- **Problem**: Every `spawn()` call makes a `git ls-remote --heads origin` network call to check for remote branch collisions. On fast networks this adds ~200ms; on slow networks or during outages, it can add seconds or cause timeouts.
- **Benefit**: Faster session spawning, especially for batch operations.
- **Suggested Approach**: Cache the result for 30 seconds (the lifecycle poll interval) using a simple `{ value, expiresAt }` pattern. The remote session number set changes slowly enough that a 30s TTL is safe.

### Enhancement: Add structured logging to `tmux.ts` delays
- **Location**: `packages/core/src/tmux.ts:133,168`
- **Problem**: Hardcoded `setTimeout(resolve, 100)` and `setTimeout(resolve, 1000)` delays for tmux paste buffer timing are undocumented magic numbers.
- **Benefit**: Makes it easier to tune and debug tmux timing issues on different systems.
- **Suggested Approach**: Extract as named constants with JSDoc explaining why the delay exists:
  ```typescript
  /** Delay after Escape to ensure tmux processes it before paste. Tuned for tmux 3.x. */
  const ESCAPE_SETTLE_MS = 100;
  /** Delay after paste-buffer to ensure tmux processes content before Enter keystroke. */
  const PASTE_SETTLE_MS = 1000;
  ```

### Enhancement: Add `formatRecoveryReport` usage or remove it
- **Location**: `packages/core/src/recovery/logger.ts:33-65`
- **Problem**: `formatRecoveryReport` is exported but appears unused in the core package. If it's used by the CLI, it should stay. If not, it's dead code.
- **Benefit**: Reduced surface area for maintenance.
- **Suggested Approach**: Check if the CLI or any consumer imports this function. If not, remove it.
