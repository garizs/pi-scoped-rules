# pi-scoped-rules

Scoped, ephemeral project rules for [Pi coding agent](https://github.com/badlogic/pi-mono).

## Why this exists

Generic MDC / rules integrations often have two problems on long runs:

1. they dedupe by file path instead of logical rule scope
2. they inject full rule blobs into persistent conversation history

This package intentionally supports **one canonical rule format only**. No format zoo, no alias guessing, no trigger inference from foreign conventions.

That can waste context on broad tasks that touch many files, layers, or subsystems.

`pi-scoped-rules` is built to solve that by:

- loading project rules from Markdown / MDC files
- matching them by file globs and logical scopes
- blocking only mutating actions when required scoped rules are missing or not visible in the current provider call
- injecting rule guidance **ephemerally** via Pi's `context` event
- avoiding persistent `custom_message` rule blobs in session history
- keeping runtime state outside LLM context

## Key behavior

### 1. Rules are versioned project files

By default the extension loads rules from:

- `.agents/rules/`
- `.pi/rules/`

It loads **only `.mdc` files**.

### 2. Mutations are gated, reads are not

By default the extension only watches these mutating tools:

- `edit`
- `write`

If a mutation targets a path matched by scoped rules and those scopes were not visible in the current provider call, the tool call is blocked with a **short** reason.
For existing files, the agent must also successfully `read` the exact target file before later mutations of that file are allowed.

### 3. Scoped guidance is ephemeral

When a mutation is blocked, the relevant scopes are queued for one-shot guidance injection on the **next** LLM call.
A successful `read` of the exact target file then arms those scopes for the current run, records that file as eligible for mutation, and queues the same scoped guidance again for the following model step that will plan the mutation.
In the default strict mode, `armed` is only bookkeeping: `edit` / `write` is allowed only from a model response generated while the matching scoped rules were visible.

For read-only agents that do not expose mutating tools, the extension switches to a read-analysis primer instead of a mutation primer, but the scoped guidance is still injected ephemerally after relevant file reads.

That means:

- matching scoped rules influence the next model step after a blocked mutation
- a `read` of the exact target file is required before mutating existing scoped files
- read-only review / analysis agents still get matching scoped guidance after reading relevant files
- the same rule blob is **not** re-injected on every later call in the run
- visible scoped rules are tracked per provider call and cleared when no rules are injected
- armed scopes do not grant mutation permission in the default strict mode

If `renderMode` is `"condensed"`, the extension keeps the same matching rules but rewrites them into a deterministic compact form:

- strips boilerplate lead-in phrases
- prefers concrete bullet points / numbered guidance
- collapses whitespace
- caps each rule to a short bounded set of lines
- keeps the same matched rule set (selection does not change)

This keeps selection deterministic while shrinking token cost.

This means the scoped rules:

- are visible to the model when needed
- do **not** become persistent session history
- do **not** keep rotting the context across future turns

### 4. Scopes clear at the end of the run

Active scopes are cleared on `agent_end`.

## Canonical .mdc format

Each rule file must be a `.mdc` file with YAML frontmatter and a non-empty Markdown body.

### Supported frontmatter keys

- `trigger` — required, one of: `always_on`, `glob`, `model_decision`
- `scope` — required, non-empty string
- `description` — required for `model_decision`, optional otherwise
- `globs` — required for `glob`, forbidden otherwise
- `name` — optional display name (defaults to filename)

No other frontmatter keys are supported.

### Example: `always_on`

```md
---
trigger: always_on
scope: baseline
description: Global coding baseline
---

- Use explicit access modifiers.
- Keep code readable.
```

### Example: `glob`

```md
---
trigger: glob
scope: runtime-placement
globs:
  - "Assets/Scripts/Runtime/Placement/**/*.cs"
description: Placement rules
---

- Keep placement ownership explicit.
- Separate preview from commit.
```

### Example: `model_decision`

```md
---
trigger: model_decision
scope: python-performance
description: Use when working on Python hot paths and allocation-sensitive code.
---

- Prefer reusable buffers over repeated transient allocations.
- Measure before and after optimization.
```

## Validation behavior

Invalid `.mdc` files produce diagnostics.

Examples of invalid input:

- missing frontmatter
- unknown frontmatter keys
- missing `trigger`
- missing `scope`
- missing `globs` for `trigger: glob`
- `globs` present on non-`glob` rules
- missing `description` for `trigger: model_decision`
- empty rule body

If diagnostics are present, mutating tool calls are blocked until the invalid rule files are fixed.

## Optional project config

Create `.pi/scoped-rules.json` in a project root to configure rule directories and custom mutating tools.

Example:

```json
{
  "ruleDirs": [".agents/rules", ".pi/rules"],
  "includeModelDecisionSummary": false,
  "renderMode": "condensed",
  "enforcementMode": "visible_in_current_context",
  "mutatingTools": [
    { "toolName": "edit", "pathFields": ["path"] },
    { "toolName": "write", "pathFields": ["path"] },
    { "toolName": "ai_game_developer_script-update-or-create", "pathFields": ["filePath"] },
    { "toolName": "ai_game_developer_script-delete", "pathFields": ["files"] }
  ]
}
```

Config fields:

- `ruleDirs`: directories to scan for `.md` / `.mdc` rules
- `includeModelDecisionSummary`: optionally list `model_decision` rules in the system prompt
- `renderMode`: `"full"` or `"condensed"`
- `enforcementMode`: `"visible_in_current_context"` (default strict mode) or `"armed_scope"` (legacy compatibility)
- `mutatingTools`: custom tool -> path field mappings

`pathFields` can point to either:

- a single string field
- an array-of-strings field

## Commands

- `/scoped-rules-status` — shows loaded rules plus armed, pending, and last-visible scopes

## Current design choices

- **Scope dedupe instead of path dedupe**
- **Mutation-only gating** by default
- **Ephemeral context injection** instead of persistent history pollution
- **Short global prompt overhead**
- **Project-local rule source files** that remain easy to version and review

## Inspired by

This package is inspired by:

- the broader **Cursor Rules / MDC** ecosystem, especially community rule collections and conventions around scoped Markdown rule files:
  - https://github.com/sanjeed5/awesome-cursor-rules-mdc
  - https://github.com/Common-ka/ai-agent-unity-rules
- **pi-mdc-rules**, which showed that Markdown-driven rule enforcement is useful in Pi, but also highlighted the context-cost tradeoffs of persistent rule injection:
  - https://www.npmjs.com/package/pi-mdc-rules

This package is **inspired by** those ecosystems, but it deliberately does **not** try to support every external rule syntax. `pi-scoped-rules` defines one strict `.mdc` format and validates against that format.

The main difference in `pi-scoped-rules` is the emphasis on **scope dedupe** and **ephemeral context injection** through Pi's `context` event.

## Development

```bash
npm install
npm run typecheck
npm test
```

## Installation target

Planned npm package name:

- `pi-scoped-rules`

## License

MIT
