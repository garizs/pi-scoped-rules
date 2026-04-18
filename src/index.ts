import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";
import { loadRules } from "./loader.js";
import { buildAlwaysOnPrompt, buildModelDecisionPrompt, buildScopedContextMessage, stripScopedContextMessages } from "./render.js";
import { armScopes, clearArmedScopes, clearPendingScopes, extractMutationPaths, getAlwaysOnRules, getMissingScopesForPaths, getModelDecisionRules, getPendingScopedRules } from "./runtime.js";
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

	pi.on("session_start", async (_event, ctx) => {
		reloadProjectState(ctx.cwd);
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
	});

	pi.on("before_agent_start", async (event, ctx) => {
		reloadProjectState(ctx.cwd);

		const diagnosticsPrompt = state.diagnostics.length > 0
			? `\n\n## Scoped rule diagnostics\n\n${state.diagnostics.length} rule file(s) are invalid. Mutating tool calls may be blocked until the rule files are fixed.`
			: "";
		const alwaysOnPrompt = buildAlwaysOnPrompt(getAlwaysOnRules(state.rules));
		const modelDecisionPrompt = state.config.includeModelDecisionSummary
			? buildModelDecisionPrompt(getModelDecisionRules(state.rules))
			: "";
		const systemPrompt =
			event.systemPrompt
			+ "\n\n## Scoped project rules\n"
			+ "Project-specific scoped rules may be activated ephemerally before mutating tool calls."
			+ " Avoid repeating rule blobs in persistent conversation history."
			+ diagnosticsPrompt
			+ alwaysOnPrompt
			+ modelDecisionPrompt;

		return { systemPrompt };
	});

	pi.on("context", async (event, ctx) => {
		reloadProjectState(ctx.cwd);
		const pendingRules = getPendingScopedRules(state);
		if (pendingRules.length === 0) {
			return { messages: stripScopedContextMessages(event.messages) };
		}

		const messages = stripScopedContextMessages(event.messages);
		messages.push(buildScopedContextMessage(pendingRules, state.config.renderMode));
		clearPendingScopes(state);
		return { messages };
	});

	pi.on("tool_call", async (event, ctx) => {
		reloadProjectState(ctx.cwd);

		const mutationPaths = extractMutationPaths(event.toolName, event.input as Record<string, unknown>, state.config);
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
		if (missingScopes.length === 0) {
			return;
		}

		armScopes(state, missingScopes);
		state.lastBlockedPath = mutationPaths[0];
		state.lastBlockedScopes = missingScopes;

		if (ctx.hasUI) {
			ctx.ui.notify(`Scoped rules activated for ${mutationPaths[0]}: ${missingScopes.join(", ")}`, "info");
		}

		return {
			block: true,
			reason:
				`Scoped project rules are required before mutating \"${mutationPaths[0]}\". `
				+ `Activated scopes: ${missingScopes.join(", ")}. `
				+ "Review the scoped guidance on the next model call and retry the mutation.",
		};
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
			const rulesList = state.rules.map((rule) => `${rule.name} [${rule.trigger}] -> ${rule.scope}`).join("\n") || "(none)";
			const diagnostics = state.diagnostics.map((entry) => `- ${entry.relativePath}: ${entry.message}`).join("\n") || "(none)";
			ctx.ui.notify(`Armed scopes: ${armed}\nPending one-shot scopes: ${pending}\nRules:\n${rulesList}\nDiagnostics:\n${diagnostics}`, "info");
		},
	});
}
