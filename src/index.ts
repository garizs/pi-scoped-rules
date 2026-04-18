import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";
import { loadRules } from "./loader.js";
import { buildAlwaysOnPrompt, buildModelDecisionPrompt, buildScopedContextMessage, stripScopedContextMessages } from "./render.js";
import { activateScopes, clearActiveScopes, extractMutationPaths, getActiveScopedRules, getAlwaysOnRules, getMissingScopesForPaths, getModelDecisionRules } from "./runtime.js";
import type { RuntimeState } from "./types.js";

const STATUS_ID = "pi-scoped-rules";

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
		activeScopes: new Set<string>(),
	};
}

export default function piScopedRules(pi: ExtensionAPI) {
	const state = createInitialState();

	function reloadProjectState(cwd: string): void {
		state.config = loadConfig(cwd);
		state.rules = loadRules(cwd, state.config);
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) {
			return;
		}

		const alwaysOnCount = getAlwaysOnRules(state.rules).length;
		const scopedCount = state.rules.filter((rule) => rule.trigger === "glob").length;
		const activeCount = state.activeScopes.size;
		const theme = ctx.ui.theme;
		const prefix = activeCount > 0 ? theme.fg("accent", "● ") : theme.fg("dim", "○ ");
		ctx.ui.setStatus(STATUS_ID, prefix + theme.fg("dim", `scoped-rules a:${alwaysOnCount} s:${scopedCount} active:${activeCount}`));
	}

	pi.on("session_start", async (_event, ctx) => {
		reloadProjectState(ctx.cwd);
		updateStatus(ctx);
		if (ctx.hasUI && state.rules.length > 0) {
			ctx.ui.notify(`Scoped rules: loaded ${state.rules.length} rule(s)`, "info");
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		reloadProjectState(ctx.cwd);
		updateStatus(ctx);

		const alwaysOnPrompt = buildAlwaysOnPrompt(getAlwaysOnRules(state.rules));
		const modelDecisionPrompt = state.config.includeModelDecisionSummary
			? buildModelDecisionPrompt(getModelDecisionRules(state.rules))
			: "";
		const systemPrompt =
			event.systemPrompt
			+ "\n\n## Scoped project rules\n"
			+ "Project-specific scoped rules may be activated ephemerally before mutating tool calls."
			+ " Avoid repeating rule blobs in persistent conversation history."
			+ alwaysOnPrompt
			+ modelDecisionPrompt;

		return { systemPrompt };
	});

	pi.on("context", async (event, ctx) => {
		reloadProjectState(ctx.cwd);
		const activeRules = getActiveScopedRules(state);
		if (activeRules.length === 0) {
			return { messages: stripScopedContextMessages(event.messages) };
		}

		const messages = stripScopedContextMessages(event.messages);
		messages.push(buildScopedContextMessage(activeRules, state.config.renderMode));
		updateStatus(ctx);
		return { messages };
	});

	pi.on("tool_call", async (event, ctx) => {
		reloadProjectState(ctx.cwd);

		const mutationPaths = extractMutationPaths(event.toolName, event.input as Record<string, unknown>, state.config);
		if (mutationPaths.length === 0) {
			return;
		}

		const missingScopes = getMissingScopesForPaths(mutationPaths, state.rules, state.activeScopes);
		if (missingScopes.length === 0) {
			return;
		}

		activateScopes(state, missingScopes);
		state.lastBlockedPath = mutationPaths[0];
		state.lastBlockedScopes = missingScopes;
		updateStatus(ctx);

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

	pi.on("agent_end", async (_event, ctx) => {
		clearActiveScopes(state);
		updateStatus(ctx);
	});

	pi.registerCommand("scoped-rules-status", {
		description: "Show loaded scoped rules and currently active scopes",
		handler: async (_args, ctx) => {
			reloadProjectState(ctx.cwd);
			updateStatus(ctx);
			if (!ctx.hasUI) {
				return;
			}

			const active = state.activeScopes.size > 0 ? [...state.activeScopes].join(", ") : "none";
			const rulesList = state.rules.map((rule) => `${rule.name} [${rule.trigger}] -> ${rule.scope}`).join("\n");
			ctx.ui.notify(`Active scopes: ${active}\nRules:\n${rulesList}`, "info");
		},
	});
}
