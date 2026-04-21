import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";
import { loadRules } from "./loader.js";
import { buildAlwaysOnPrompt, buildModelDecisionPrompt, buildScopedBlockedReason, buildScopedContextMessage, buildScopedMutationPrimer, buildScopedReadPrimer, stripScopedContextMessages } from "./render.js";
import { armScopes, clearArmedScopes, clearPendingScopes, extractMutationPaths, getAlwaysOnRules, getGlobRules, getInactiveMatchingScopesForPaths, getMatchingScopesForPaths, getMissingScopesForPaths, getModelDecisionRules, getPendingScopedRules, getUnreadScopedPaths, queuePendingScopes, rememberReadPaths } from "./runtime.js";
import type { RuntimeState } from "./types.js";

function createInitialState(): RuntimeState {
	return {
		config: {
			ruleDirs: [".agents/rules", ".pi/rules"],
			mutatingTools: [
				{ toolName: "edit", pathFields: ["path"] },
				{ toolName: "write", pathFields: ["path"] },
			],
			includeModelDecisionSummary: false,
			renderMode: "full",
		},
		rules: [],
		diagnostics: [],
		armedScopes: new Set<string>(),
		pendingScopes: new Set<string>(),
		readPaths: new Set<string>(),
	};
}

export default function piScopedRules(pi: ExtensionAPI) {
	const state = createInitialState();

	function reloadProjectState(cwd: string): void {
		state.config = loadConfig(cwd);
		const result = loadRules(cwd, state.config);
		state.rules = result.rules;
		state.diagnostics = result.diagnostics;
	}

	function resetRunState(): void {
		clearArmedScopes(state);
	}

	function notifyRuleLoad(ctx: { hasUI: boolean; ui: { notify: (message: string, level: "info" | "error") => void } }): void {
		if (!ctx.hasUI) {
			return;
		}
		if (state.diagnostics.length > 0) {
			ctx.ui.notify(`Scoped rules: ${state.diagnostics.length} validation error(s). Run /scoped-rules-status`, "error");
			return;
		}
		if (state.rules.length > 0) {
			ctx.ui.notify(`Scoped rules: loaded ${state.rules.length} rule(s)`, "info");
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		reloadProjectState(ctx.cwd);
		resetRunState();
		notifyRuleLoad(ctx);
	});

	pi.on("session_switch" as never, async (_event: unknown, ctx: ExtensionContext) => {
		reloadProjectState(ctx.cwd);
		resetRunState();
		notifyRuleLoad(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		reloadProjectState(ctx.cwd);

		const activeTools = new Set((event.systemPromptOptions.selectedTools ?? []).map((toolName) => toolName.trim()));
		const hasActiveMutatingTools = state.config.mutatingTools.some((spec) => activeTools.has(spec.toolName));
		const diagnosticsPrompt = state.diagnostics.length > 0
			? hasActiveMutatingTools
				? `\n\n## Scoped rule diagnostics\n\n${state.diagnostics.length} rule file(s) are invalid. Mutating tool calls may be blocked until the rule files are fixed.`
				: `\n\n## Scoped rule diagnostics\n\n${state.diagnostics.length} rule file(s) are invalid. Scoped read guidance may be incomplete until the rule files are fixed.`
			: "";
		const globPrimer = hasActiveMutatingTools
			? buildScopedMutationPrimer(getGlobRules(state.rules))
			: buildScopedReadPrimer(getGlobRules(state.rules));
		const alwaysOnPrompt = buildAlwaysOnPrompt(getAlwaysOnRules(state.rules));
		const modelDecisionPrompt = state.config.includeModelDecisionSummary
			? buildModelDecisionPrompt(getModelDecisionRules(state.rules))
			: "";
		const promptSuffix = diagnosticsPrompt + globPrimer + alwaysOnPrompt + modelDecisionPrompt;
		if (promptSuffix.length === 0) {
			return;
		}

		const intro = hasActiveMutatingTools
			? "Project-specific scoped rules may be activated ephemerally after relevant reads and before mutating tool calls. Avoid repeating rule blobs in persistent conversation history."
			: "Project-specific scoped rules may be activated ephemerally after relevant file reads so review and analysis stay file-aware without polluting persistent conversation history.";

		return {
			systemPrompt:
				event.systemPrompt
				+ "\n\n## Scoped project rules\n"
				+ intro
				+ promptSuffix,
		};
	});

	pi.on("context", async (event, ctx) => {
		reloadProjectState(ctx.cwd);
		const pendingRules = getPendingScopedRules(state);
		const messages = stripScopedContextMessages(event.messages);
		if (pendingRules.length === 0) {
			return { messages };
		}

		const transition = state.lastBlockedPath && state.lastBlockedScopes
			? {
				kind: "blocked" as const,
				targetPath: state.lastBlockedPath,
				scopes: state.lastBlockedScopes,
				unreadPaths: state.lastBlockedUnreadPaths ?? [],
			}
			: state.lastActivatedPath && state.lastActivatedScopes
				? {
					kind: "armed" as const,
					targetPath: state.lastActivatedPath,
					scopes: state.lastActivatedScopes,
				}
				: undefined;

		messages.push(buildScopedContextMessage(pendingRules, state.config.renderMode, transition));
		if (ctx.hasUI && transition) {
			if (transition.kind === "blocked" && transition.unreadPaths.length === 0) {
				ctx.ui.notify(
					`Scoped rules armed for file creation ${transition.targetPath}: ${transition.scopes.join(", ")}`,
					"info",
				);
			} else if (transition.kind === "armed") {
				ctx.ui.notify(
					`Scoped rules injected after read ${transition.targetPath}: ${transition.scopes.join(", ")}`,
					"info",
				);
			}
		}
		clearPendingScopes(state);
		return { messages };
	});

	pi.on("tool_call", async (event, ctx) => {
		reloadProjectState(ctx.cwd);

		const mutationPaths = extractMutationPaths(event.toolName, event.input as Record<string, unknown>, state.config, ctx.cwd);
		if (mutationPaths.length === 0) {
			return;
		}

		if (state.diagnostics.length > 0) {
			return {
				block: true,
				reason:
					"Scoped rule files contain validation errors. Fix the invalid .mdc files first. "
					+ "Run /scoped-rules-status to inspect diagnostics.",
			};
		}

		const missingScopes = getMissingScopesForPaths(mutationPaths, state.rules, state.armedScopes);
		const unreadScopedPaths = getUnreadScopedPaths(
			mutationPaths,
			state.rules,
			state.readPaths,
			ctx.cwd,
		);
		if (missingScopes.length === 0 && unreadScopedPaths.length === 0) {
			return;
		}

		const queuedScopes = [
			...new Set([
				...missingScopes,
				...getMatchingScopesForPaths(unreadScopedPaths, state.rules),
			]),
		].sort();
		queuePendingScopes(state, queuedScopes);
		if (unreadScopedPaths.length === 0) {
			armScopes(state, queuedScopes);
		}
		state.lastActivatedPath = undefined;
		state.lastActivatedScopes = undefined;
		state.lastBlockedPath = mutationPaths[0];
		state.lastBlockedScopes = queuedScopes;
		state.lastBlockedUnreadPaths = unreadScopedPaths;

		if (ctx.hasUI) {
			ctx.ui.notify(`Scoped rules queued for ${mutationPaths[0]}: ${queuedScopes.join(", ")}`, "info");
		}

		return {
			block: true,
			reason: buildScopedBlockedReason(mutationPaths[0], queuedScopes, unreadScopedPaths),
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		reloadProjectState(ctx.cwd);
		if (event.toolName !== "read" || event.isError) {
			return;
		}

		const readPaths = extractMutationPaths("write", event.input as Record<string, unknown>, {
			...state.config,
			mutatingTools: [{ toolName: "write", pathFields: ["path"] }],
		}, ctx.cwd);
		if (readPaths.length === 0) {
			return;
		}

		const matchingScopes = getMatchingScopesForPaths(readPaths, state.rules);
		if (matchingScopes.length === 0) {
			return;
		}

		rememberReadPaths(state, readPaths);
		state.lastBlockedPath = undefined;
		state.lastBlockedScopes = undefined;
		state.lastBlockedUnreadPaths = undefined;
		const activatedScopes = getInactiveMatchingScopesForPaths(readPaths, state.rules, state.armedScopes);
		if (activatedScopes.length > 0) {
			armScopes(state, activatedScopes);
			state.lastActivatedPath = readPaths[0];
			state.lastActivatedScopes = activatedScopes;
		} else {
			state.lastActivatedPath = readPaths[0];
			state.lastActivatedScopes = matchingScopes;
			queuePendingScopes(state, matchingScopes);
		}

		if (ctx.hasUI) {
			ctx.ui.notify(`Scoped rules refreshed from read ${readPaths[0]}: ${matchingScopes.join(", ")}`, "info");
		}
	});

	pi.on("agent_end", async () => {
		clearArmedScopes(state);
	});

	pi.registerCommand("scoped-rules-status", {
		description: "Show loaded scoped rules and currently armed/pending scopes",
		handler: async (_args, ctx) => {
			reloadProjectState(ctx.cwd);
			if (!ctx.hasUI) {
				return;
			}

			const armed = state.armedScopes.size > 0 ? [...state.armedScopes].join(", ") : "none";
			const pending = state.pendingScopes.size > 0 ? [...state.pendingScopes].join(", ") : "none";
			const readPaths = state.readPaths.size > 0 ? [...state.readPaths].join(", ") : "none";
			const rulesList = state.rules.map((rule) => `${rule.name} [${rule.trigger}] -> ${rule.scope}`).join("\n") || "(none)";
			const diagnostics = state.diagnostics.map((entry) => `- ${entry.relativePath}: ${entry.message}`).join("\n") || "(none)";
			ctx.ui.notify(`Armed scopes: ${armed}\nPending one-shot scopes: ${pending}\nRead scoped files: ${readPaths}\nRules:\n${rulesList}\nDiagnostics:\n${diagnostics}`, "info");
		},
	});
}
