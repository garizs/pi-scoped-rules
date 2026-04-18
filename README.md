# pi-scoped-rules

Scoped, ephemeral project rules for [Pi coding agent](https://github.com/badlogic/pi-mono).

## Why this exists

Generic MDC / rules integrations often have two problems on long runs:

1. they dedupe by file path instead of logical rule scope
2. they inject full rule blobs into persistent conversation history

That can waste context on broad tasks that touch many files, layers, or subsystems.

`pi-scoped-rules` is built to solve that by:

- loading project rules from Markdown / MDC files
- matching them by file globs and logical scopes
- blocking only mutating actions when required scoped rules are missing
- injecting rule guidance **ephemerally** via Pi's `context` event
- avoiding persistent `custom_message` rule blobs in session history
- keeping runtime state outside LLM context

## Key behavior

### 1. Rules are versioned project files

By default the extension loads rules from:

- `.agents/rules/`
- `.pi/rules/`

It supports both `.md` and `.mdc` files.

### 2. Mutations are gated, reads are not

By default the extension only watches these mutating tools:

- `edit`
- `write`

If a mutation targets a path matched by scoped rules and those scopes are not active for the current run, the tool call is blocked with a **short** reason.

### 3. Scoped guidance is ephemeral

When a mutation is blocked, the relevant scopes are activated for the current agent run.
On subsequent LLM calls in that same run, the extension injects the matching rules through Pi's `context` event.

This means the scoped rules:

- are visible to the model when needed
- do **not** become persistent session history
- do **not** keep rotting the context across future turns

### 4. Scopes clear at the end of the run

Active scopes are cleared on `agent_end`.

## Supported frontmatter

The loader supports multiple styles so the same project can adapt rules from Pi, Cursor, or Copilot-style sources.

### Pi-style explicit trigger

```md
---
trigger: glob
globs:
  - "src/**/*.ts"
scope: backend-api
description: Backend API rules
---

Rule body here.
```

### Cursor / MDC-style

```md
---
alwaysApply: true
---

Always-on guidance.
```

```md
---
description: Unity runtime rules
globs: "Assets/Scripts/Runtime/**/*.cs"
---

Scoped rule body here.
```

### Copilot-style `applyTo`

```md
---
description: Python service rules
applyTo: "services/**/*.py"
---

Scoped rule body here.
```

## Trigger semantics

- `always_on`
  - injected into the system prompt every run
- `glob`
  - activated by matching file mutations
- `model_decision`
  - loaded and available, but not automatically injected unless you build higher-level behavior around them

If `trigger` is omitted, the loader infers it:

- `alwaysApply: true` -> `always_on`
- `globs` or `applyTo` present -> `glob`
- otherwise -> `model_decision`

## Optional project config

Create `.pi/scoped-rules.json` in a project root to configure rule directories and custom mutating tools.

Example:

```json
{
  "ruleDirs": [".agents/rules", ".pi/rules"],
  "includeModelDecisionSummary": false,
  "mutatingTools": [
    { "toolName": "edit", "pathFields": ["path"] },
    { "toolName": "write", "pathFields": ["path"] },
    { "toolName": "ai_game_developer_script-update-or-create", "pathFields": ["filePath"] },
    { "toolName": "ai_game_developer_script-delete", "pathFields": ["files"] }
  ]
}
```

`pathFields` can point to either:

- a single string field
- an array-of-strings field

## Commands

- `/scoped-rules-status` — shows loaded rules and currently active scopes

## Current design choices

- **Scope dedupe instead of path dedupe**
- **Mutation-only gating** by default
- **Ephemeral context injection** instead of persistent history pollution
- **Short global prompt overhead**
- **Project-local rule source files** that remain easy to version and review

## Development

```bash
npm install
npm run typecheck
```

## Installation target

Planned npm package name:

- `pi-scoped-rules`

## License

MIT
