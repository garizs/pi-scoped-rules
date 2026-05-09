import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { loadRules } from "./loader.js";
import { buildAlwaysOnPrompt, buildModelDecisionPrompt, buildScopedContextMessage, buildScopedMutationPrimer, buildScopedPreparedReason, buildScopedReadPrimer, buildScopedVisibilityFailureReason, redactBlockedMutationToolCalls, stripScopedContextMessages } from "./render.js";
import { clearActiveIntentForMutation, clearPendingScopes, clearTransientRunState, confirmInflightInjection, createVisibilityFailureKey, evaluateScopedMutationGate, extractMutationPaths, getAlwaysOnRules, getGlobRules, getModelDecisionRules, getPendingScopedRules, getReinjectableIntentScopes, getRulesForScopes, queuePendingScopes, rememberBlockedToolCall, rememberInflightInjection, rememberVisibilityFailure, setActiveIntent, startProviderCall } from "./runtime.js";
import type { RuntimeState, ScopedTransitionNotice } from "./types.js";

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
			enforcementMode: "visible_in_current_context",
		},
		rules: [],
		diagnostics: [],
		rulesRevision: "",
		pendingScopes: new Set<string>(),
		providerCallSeq: 0,
		blockedToolCalls: new Map(),
	};
}

function hasAnyRuleFiles(state: RuntimeState): boolean {
	return state.rules.length > 0 || state.diagnostics.length > 0;
}

function hasScopedMutationRules(state: RuntimeState): boolean {
	return getGlobRules(state.rules).length > 0;
}

function isSubset(required: string[], available: string[]): boolean {
	return required.every((scope) => available.includes(scope));
}

function safeStringifyPayload(payload: unknown): string {
	try {
		return JSON.stringify(payload);
	} catch {
		return "";
	}
}

function createNonce(): string {
	return `pi-scoped-rules:${randomUUID()}`;
}

export default function piScopedRules(pi: ExtensionAPI) {
	const state = createInitialState();

	function reloadProjectState(cwd: string): void {
		state.config = loadConfig(cwd);
		const result = loadRules(cwd, state.config);
		state.rules = result.rules;
		state.diagnostics = result.diagnostics;
		state.rulesRevision = result.revision;
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
		clearTransientRunState(state);
		notifyRuleLoad(ctx);
	});

	pi.on("session_switch" as never, async (_event: unknown, ctx: ExtensionContext) => {
		reloadProjectState(ctx.cwd);
		clearTransientRunState(state);
		notifyRuleLoad(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		reloadProjectState(ctx.cwd);
		if (!hasAnyRuleFiles(state)) {
			return;
		}

		const activeTools = new Set((event.systemPromptOptions.selectedTools ?? []).map((toolName) => toolName.trim()));
		const hasActiveMutatingTools = state.config.mutatingTools.some((spec) => activeTools.has(spec.toolName));
		const diagnosticsPrompt = state.diagnostics.length > 0
			? hasActiveMutatingTools
				? `\n\n## Scoped rule diagnostics\n\n${state.diagnostics.length} rule file(s) are invalid. Mutating tool calls are blocked until the rule files are fixed.`
				: `\n\n## Scoped rule diagnostics\n\n${state.diagnostics.length} rule file(s) are invalid. Scoped rule guidance may be incomplete until the rule files are fixed.`
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
			? "Project-specific scoped rules are enforced lazily for matching mutating tool calls. Full scoped rules are injected ephemerally only after a matching mutation is paused, avoiding persistent history pollution."
			: "Project-specific scoped rules are available for review and analysis without persistent scoped-rule history pollution.";

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
		const providerCallId = startProviderCall(state);
		let messages = redactBlockedMutationToolCalls(stripScopedContextMessages(event.messages), state.blockedToolCalls);

		if (!hasScopedMutationRules(state)) {
			return { messages };
		}

		let scopesToInject = [...state.pendingScopes].sort();
		if (scopesToInject.length === 0) {
			scopesToInject = getReinjectableIntentScopes(state);
		}
		if (scopesToInject.length === 0) {
			return { messages };
		}

		const pendingRules = scopesToInject.length > 0
			? getRulesForScopes(state, scopesToInject)
			: getPendingScopedRules(state);
		if (pendingRules.length === 0) {
			clearPendingScopes(state);
			return { messages };
		}

		const nonce = createNonce();
		rememberInflightInjection(state, {
			providerCallId,
			nonce,
			scopes: [...new Set(pendingRules.map((rule) => rule.scope))].sort(),
			rulesRevision: state.rulesRevision,
		});

		const transition: ScopedTransitionNotice | undefined = state.lastBlockedPath && state.lastBlockedScopes
			? {
				kind: "blocked",
				targetPath: state.lastBlockedPath,
				scopes: state.lastBlockedScopes,
			}
			: state.lastPreparedPath && state.lastPreparedScopes
				? {
					kind: "prepared",
					targetPath: state.lastPreparedPath,
					scopes: state.lastPreparedScopes,
				}
				: undefined;

		messages.push(buildScopedContextMessage(pendingRules, state.config.renderMode, nonce, transition));
		if (ctx.hasUI) {
			const injectedScopes = [...new Set(pendingRules.map((rule) => rule.scope))].sort();
			ctx.ui.notify(
				`Scoped rules injected for scopes: ${injectedScopes.join(", ")}`,
				"info",
			);
		}
		clearPendingScopes(state);
		state.lastPreparedPath = state.lastBlockedPath;
		state.lastPreparedScopes = state.lastBlockedScopes;
		state.lastBlockedPath = undefined;
		state.lastBlockedScopes = undefined;
		return { messages };
	});

	pi.on("before_provider_request", async (event) => {
		if (!state.inflightInjection || state.inflightInjection.providerCallId !== state.currentProviderCallId) {
			return;
		}
		confirmInflightInjection(state, safeStringifyPayload(event.payload));
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

		if (!hasScopedMutationRules(state)) {
			return;
		}

		const gate = evaluateScopedMutationGate(mutationPaths, state, ctx.cwd);
		if (gate.allowed) {
			clearActiveIntentForMutation(state, mutationPaths, gate.matchingScopes);
			state.lastVisibilityFailureKey = undefined;
			state.visibilityFailureCount = undefined;
			return;
		}

		queuePendingScopes(state, gate.matchingScopes);
		setActiveIntent(state, mutationPaths, gate.matchingScopes);
		rememberBlockedToolCall(state, event.toolCallId, event.toolName, mutationPaths, gate.matchingScopes);
		state.lastPreparedPath = undefined;
		state.lastPreparedScopes = undefined;
		state.lastBlockedPath = mutationPaths[0];
		state.lastBlockedScopes = gate.matchingScopes;

		if (gate.reason === "visibility_failed" || gate.reason === "rules_changed") {
			const failureKey = createVisibilityFailureKey(mutationPaths, gate.matchingScopes);
			const failureCount = rememberVisibilityFailure(state, failureKey);
			if (ctx.hasUI) {
				ctx.ui.notify(`Scoped rules visibility failed for ${mutationPaths[0]}: ${gate.matchingScopes.join(", ")}`, "error");
			}
			if (failureCount >= 1) {
				ctx.abort();
			}
			return {
				block: true,
				reason: buildScopedVisibilityFailureReason(mutationPaths[0] ?? "(unknown)", gate.matchingScopes),
			};
		}

		if (ctx.hasUI) {
			ctx.ui.notify(`Scoped rules prepared for ${mutationPaths[0]}: ${gate.matchingScopes.join(", ")}`, "info");
		}

		return {
			block: true,
			reason: buildScopedPreparedReason(mutationPaths[0] ?? "(unknown)", gate.matchingScopes),
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		reloadProjectState(ctx.cwd);
		if (event.isError) {
			return;
		}

		const mutationPaths = extractMutationPaths(event.toolName, event.input as Record<string, unknown>, state.config, ctx.cwd);
		if (mutationPaths.length === 0 || !state.activeIntent) {
			return;
		}

		const gate = evaluateScopedMutationGate(mutationPaths, state, ctx.cwd);
		clearActiveIntentForMutation(state, mutationPaths, gate.matchingScopes);
	});

	pi.on("agent_end", async () => {
		clearTransientRunState(state);
	});

	pi.registerCommand("scoped-rules-status", {
		description: "Show loaded scoped rules and currently pending/visible scopes",
		handler: async (_args, ctx) => {
			reloadProjectState(ctx.cwd);
			if (!ctx.hasUI) {
				return;
			}

			const pending = state.pendingScopes.size > 0 ? [...state.pendingScopes].join(", ") : "none";
			const visible = state.confirmedVisibility ? state.confirmedVisibility.scopes.join(", ") : "none";
			const intent = state.activeIntent ? `${state.activeIntent.paths.join(", ")} -> ${state.activeIntent.scopes.join(", ")}` : "none";
			const rulesList = state.rules.map((rule) => `${rule.name} [${rule.trigger}] -> ${rule.scope}`).join("\n") || "(none)";
			const diagnostics = state.diagnostics.map((entry) => `- ${entry.relativePath}: ${entry.message}`).join("\n") || "(none)";
			ctx.ui.notify(`Enforcement mode: ${state.config.enforcementMode}\nRules revision: ${state.rulesRevision}\nPending one-shot scopes: ${pending}\nVisible in current provider call: ${visible}\nActive mutation intent: ${intent}\nRules:\n${rulesList}\nDiagnostics:\n${diagnostics}`, "info");
		},
	});
}
