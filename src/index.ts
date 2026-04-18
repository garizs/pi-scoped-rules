import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Project scaffold.
 *
 * Planned responsibilities:
 * - load Markdown rule files from project-local rule directories
 * - resolve logical scopes by path glob
 * - gate mutating tool calls when required scopes are missing
 * - inject scoped rule packs ephemerally via the `context` event
 * - keep rule state out of persistent LLM context/history
 */
export default function piScopedRules(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt:
				event.systemPrompt
				+ "\n\n## Scoped project rules\n"
				+ "Project-specific scoped rules may be injected ephemerally before mutating tool calls."
				+ " Prefer concise, scope-aware rule activation over persistent rule blobs in session history.",
		};
	});
}
