# Code Quality Audit Report — `packages/core/`

## Executive Summary
- **Overall Score**: 695/1000
- **Maintainability Verdict**: Requires Refactoring
- **Primary Strengths**: Well-defined plugin architecture with clear interfaces, comprehensive type definitions, atomic file operations, thorough error handling in spawn/cleanup paths, good separation between configuration validation and runtime logic.
- **Critical Weaknesses**: `session-manager.ts` is a 1400+ line god function, the lifecycle manager's `determineStatus()` has excessive cyclomatic complexity, synchronous I/O in hot paths (metadata, observability), duplicated code patterns across recovery and session management, and tight coupling between session manager internals and OpenCode-specific logic.

## File/Component Scores

| File/Path | Score /100 | Assessment |
|-----------|------------|------------|
| `types.ts` | 92 | Excellent — comprehensive, well-organized plugin interface definitions |
| `key-value.ts` | 90 | Clean, focused single-responsibility parser |
| `atomic-write.ts` | 90 | Minimal, correct POSIX atomic write |
| `opencode-session-id.ts` | 88 | Tiny, well-validated utility |
| `global-pause.ts` | 88 | Focused, correct date parsing |
| `orchestrator-session-strategy.ts` | 87 | Clean normalization function |
| `scm-webhook-utils.ts` | 85 | Good utility functions, clean extraction |
| `paths.ts` | 84 | Clear naming, but `expandHome` is duplicated from config.ts |
| `config.ts` | 82 | Solid Zod validation, but `applyDefaultReactions` embeds large hardcoded config |
| `tmux.ts` | 80 | Safe `execFile` usage, but `sendKeys` has complex branching and hardcoded delays |
| `prompt-builder.ts` | 80 | Clean layered composition, but string concatenation is fragile |
| `utils.ts` | 78 | Mixed concerns — shell escaping, JSONL reading, project resolution in one file |
| `config-generator.ts` | 78 | Good URL parsing, but `detectDefaultBranchFromDir` reads git internals directly |
| `agent-selection.ts` | 76 | Works but the priority chain is hard to follow without documentation |
| `decomposer.ts` | 75 | Clean API, but JSON.parse of LLM output has no robust fallback |
| `feedback-tools.ts` | 75 | Thorough validation, but `FeedbackReportStore` mixes I/O and domain logic |
| `plugin-registry.ts` | 74 | Functional but `loadBuiltins` swallows ALL errors silently |
| `orchestrator-prompt.ts` | 72 | Works but is a 250-line string concatenation — hard to test and maintain |
| `metadata.ts` | 70 | Correct but entirely synchronous I/O — blocks event loop on every read/write |
| `observability.ts` | 68 | Ambitious scope, but read-modify-write on every operation is a performance concern |
| `utils/session-from-metadata.ts` | 72 | Functional but IIFE inside object literal (line 28-41) is an anti-pattern |
| `utils/validation.ts` | 80 | Clean, focused |
| `utils/pr.ts` | 78 | Clean regex parsing |
| `recovery/types.ts` | 85 | Well-documented classification types |
| `recovery/scanner.ts` | 78 | Simple and correct |
| `recovery/logger.ts` | 77 | Clean but `formatRecoveryReport` is never used in core (dead code?) |
| `recovery/validator.ts` | 72 | `classifySession` has overlapping branches that obscure logic |
| `recovery/actions.ts` | 70 | Duplicated try/catch pattern across all three action functions |
| `recovery/manager.ts` | 68 | Duplicated code between `runRecovery` and `recoverSessionById` |
| `lifecycle-manager.ts` | 60 | 920-line closure with 15+ inner functions; `determineStatus` is a 150-line branching maze |
| `session-manager.ts` | 52 | 1400+ line single function closure; OpenCode-specific logic interleaved throughout |
| `index.ts` | 82 | Barrel export, well-organized |

## Detailed Findings

### Complexity & Duplication

**`session-manager.ts` — God Function (lines 266–1400+)**
The entire session manager is a single `createSessionManager()` closure containing 30+ inner functions and ~1200 lines of logic. This makes it extremely difficult to test individual behaviors, navigate the code, or reason about state. The `spawn()` function alone is ~300 lines with 4 levels of nested try/catch/cleanup. The OpenCode-specific code (`resolveOpenCodeSessionReuse`, `discoverOpenCodeSessionIdByTitle`, `findOpenCodeSessionIds`, `deleteOpenCodeSession`, `fetchOpenCodeSessionList`, etc.) adds ~200 lines of agent-specific logic into what should be a generic session manager.

**`lifecycle-manager.ts` — `determineStatus()` complexity (lines 213–365)**
This 150-line function has a cyclomatic complexity of ~25 with deeply nested if/else chains across 5 major sections (runtime check → activity detection → PR auto-detect → PR state → stuck detection). The `detectedIdleTimestamp` variable threads state across sections, making the flow hard to follow. The `maybeDispatchReviewBacklog()` function (lines 535–684) is another 150-line method with complex fingerprinting logic.

**Recovery module duplication**
`recovery/manager.ts` contains `runRecovery` and `recoverSessionById` which share ~80% of their logic (config setup, context creation, action execution, logging). The switch statement in `runRecovery` (lines 62-78) for dry-run and the one for actual execution (lines 84-100) are nearly identical.

**`recovery/actions.ts` — Repeated try/catch pattern**
All three action functions (`recoverSession`, `cleanupSession`, `escalateSession`) follow the exact same structure: check dryRun → try { update metadata } catch { return error result }. This is a textbook case for extracting a higher-order function.

**Duplicate `expandHome`**
`expandHome()` exists in both `config.ts` (line 206) and `paths.ts` (line 179) with identical implementations. `config.ts` even imports from `paths.ts` for other utilities but not this one.

### Style & Convention Adherence

**Consistent naming**: The codebase follows TypeScript conventions well — `camelCase` for functions, `PascalCase` for types/interfaces, `SCREAMING_CASE` for constants. Import style is consistent with ESM `.js` extensions and `node:` prefixes.

**Unused import**: `lifecycle-manager.ts` imports `type ProjectConfig as _ProjectConfig` (line 34) — aliased with underscore to suppress unused warning, but it's never used. Should be removed.

**`void` expressions for error suppression**: Several places use `void 0;` or `void _removed;` as no-op statements to suppress TypeScript unused variable warnings (e.g., `session-manager.ts` lines 387, 500). While functional, a more idiomatic pattern would be destructuring with `_` or using eslint-disable comments.

**Inconsistent error handling**: Some catch blocks use `catch { }` (empty), some use `catch { /* ignore */ }`, some use `catch { void 0; }`. Should pick one convention.

### Readability & Maintainability

**Closure-based architecture limits testability**: Both `session-manager.ts` and `lifecycle-manager.ts` use factory functions that return interface objects, with all logic in inner functions. This makes it impossible to unit test individual helper functions without going through the full integration path. For example, `repairSessionMetadataOnRead` (session-manager.ts, ~50 lines of complex logic) can only be tested by calling `list()` with appropriately crafted metadata files.

**`observability.ts` — Read-modify-write cycle on every operation (lines 307–331)**: Every `recordOperation()` and `setHealth()` call reads the entire JSON snapshot from disk, modifies it, and writes it back. With frequent lifecycle polling (every 30s across many sessions), this creates unnecessary I/O pressure and potential race conditions between concurrent processes writing to the same file.

**`metadata.ts` — All synchronous I/O**: Every function (`readMetadata`, `writeMetadata`, `updateMetadata`, `listMetadata`) uses `readFileSync`/`writeFileSync`. On a system with many sessions, the `list()` operation calls `statSync` for every session file (line 289), which blocks the event loop during each lifecycle poll cycle.

**IIFE in object literal** (`utils/session-from-metadata.ts` lines 28-41): The `pr` field is computed using an immediately-invoked function expression inside the return object. This makes the code harder to read and debug. Should be extracted to a separate function call.

**Magic numbers in `tmux.ts`**: Hardcoded delays of `100ms` (line 133) and `1000ms` (line 168) for paste buffer timing are undocumented. These are likely tuned for specific tmux versions and could break on different systems.

### Performance Anti-patterns

**Synchronous I/O in `listMetadata` + `loadActiveSessionRecords`**: The `list()` path in session-manager calls `loadActiveSessionRecords` which calls `listMetadata` (sync `readdirSync` + `statSync` per file), then `readMetadataRaw` (sync `readFileSync`) for each session, then `repairSessionMetadataOnRead` which may call `updateMetadata` (sync write) for each session needing repair. On a project with 50+ sessions, this is 100+ synchronous filesystem operations blocking the event loop.

**`observability.ts` — Full JSON read/parse/write per metric**: `createProjectObserver.recordOperation()` (lines 335-412) reads the entire snapshot JSON file, parses it, appends a trace, sorts all traces, trims, then writes back. This is O(n log n) per operation where n = TRACE_LIMIT (80). With lifecycle polling every 30s across multiple sessions, this adds up.

**`readLastJsonlEntry` reads backwards efficiently** but is called indirectly through agent plugins for activity detection — one call per session per poll cycle. If sessions share the same JSONL file format, results could be cached with a TTL.

**`listRemoteSessionNumbers` in `reserveNextSessionIdentity`**: Every `spawn()` call runs `git ls-remote --heads origin` (line 632-659) to check for remote branch collisions. This is a network call that adds latency to every session spawn, even when there are no collisions. Should be cached or made optional.

### Security & Error Handling

**Session ID validation is solid**: `metadata.ts` validates session IDs against `/^[a-zA-Z0-9_-]+$/` (line 50) preventing path traversal. This is applied consistently.

**`tmux.ts` uses `execFile` (not `exec`)**: Correct — avoids shell injection since arguments are passed as an array.

**`shellEscape` in utils.ts**: Proper POSIX shell escaping with single-quote wrapping (line 14-16). Used correctly for command construction.

**`parseWebhookJsonObject` lacks size validation**: While `SCMWebhookConfig` has an optional `maxBodyBytes` field, the actual `parseWebhookJsonObject` utility (scm-webhook-utils.ts, line 16) doesn't check body size before `JSON.parse`. A 100MB payload would consume memory.

**`safeJsonParse` is unsafe in type assertion**: `validation.ts` line 29 — `JSON.parse(str) as T` performs no runtime validation that the parsed value actually matches type `T`. Any caller using `safeJsonParse<RuntimeHandle>(str)` gets a potentially malformed object cast to `RuntimeHandle`. This is a type-safety gap.

**`decomposer.ts` — Unsafe JSON.parse of LLM output**: Line 152 `JSON.parse(jsonMatch[0]) as string[]` — the LLM response is trusted to produce valid JSON and a string array. While there's a basic length check, there's no validation that each element is actually a string. A malformed response could produce runtime errors downstream.

**Error swallowing in `plugin-registry.ts`**: `loadBuiltins` (lines 112-124) catches ALL errors during plugin loading with an empty catch block and a comment "Plugin not installed — that's fine." This swallows genuine errors (broken plugin code, missing dependencies) making debugging extremely difficult.

## Final Verdict

The core package is **functional and well-architected at the interface level** — the plugin system, type definitions, and configuration validation are solid. However, the two most critical files (`session-manager.ts` and `lifecycle-manager.ts`) have grown into large, complex closures that are difficult to test, navigate, and extend. The synchronous I/O pattern in metadata operations is a scalability concern for production use. The OpenCode-specific logic interleaved throughout the session manager breaks the separation of concerns that the plugin architecture was designed to provide. **Major refactoring of session-manager.ts and lifecycle-manager.ts should be prioritized**, followed by async I/O migration for metadata operations.
