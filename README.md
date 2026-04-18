# pi-scoped-rules

Scoped, ephemeral project rules for [Pi coding agent](https://github.com/badlogic/pi-mono).

## Why this exists

Generic MDC / rules integrations often have two problems on long runs:

1. they dedupe by file path instead of logical scope
2. they inject full rule blobs into persistent conversation history

That can waste context on broad tasks that touch many files, layers, or subsystems.

`pi-scoped-rules` is intended to solve that by:

- loading project rules from Markdown files
- matching them by file globs and logical scopes
- blocking only mutating actions when required scopes are missing
- injecting rule guidance **ephemerally** via Pi's `context` event
- avoiding persistent `custom_message` rule blobs in session history
- keeping rule state outside LLM context via extension custom entries / in-memory state

## Design goals

- **Scope dedupe** instead of path dedupe
- **Mutation-only gating** by default
- **Ephemeral context injection** instead of persistent history pollution
- **Short global prompt overhead**
- **Project-local rule source files** that remain easy to version and review
- **Reusable across stacks**: Unity, Python backends, TypeScript apps, etc.

## Planned architecture

### Rule sources

Project rules live in Markdown files, for example:

- `.agents/rules/`
- `.pi/rules/`

Each rule can define:

- trigger mode
- file globs
- scope id
- short description
- full rule body

### Runtime behavior

1. Agent attempts a mutating tool call (`edit`, `write`, or configured custom mutators)
2. Extension resolves matching scopes for the target path
3. If scopes are missing for the current run, the mutating tool is blocked with a **short** reason
4. On the next LLM call, the extension injects the relevant scoped rule pack via `context`
5. The LLM retries with the correct guidance in-context
6. Active scoped guidance is cleared when the agent run ends

## Why `context` event matters

Pi's `context` event can modify messages **non-destructively before each LLM call**. That means scoped rules can be added temporarily without writing them into session history.

This is better than using persistent extension messages for rules, because `custom_message` entries participate in LLM context and can accumulate over long sessions.

## Status

Early project scaffold / implementation in progress.

## Installation target

Planned npm package name:

- `pi-scoped-rules`

## License

MIT
