import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { BlockedMutationToolCall, Rule, RuleRenderMode, ScopedTransitionNotice } from "./types.js";

type EphemeralScopedContextMessage = AgentMessage & {
	role: "custom";
	customType: string;
	content: string;
	display: false;
	timestamp: number;
};

const CONTEXT_MESSAGE_TYPE = "pi-scoped-rules";
const DEFAULT_CONDENSED_RULE_LINES = 8;
const BOILERPLATE_PATTERNS = [
	/^apply (?:this|these) rules?\b/i,
	/^use (?:this|these) rules?\b/i,
	/^use this skill\b/i,
	/^apply these rules\b/i,
	/^when (?:working|editing|changing|mutating)\b/i,
	/^this rule\b/i,
	/^the following\b/i,
];

export function buildAlwaysOnPrompt(rules: Rule[]): string {
	if (rules.length === 0) {
		return "";
	}

	const sections = rules.map((rule) => `### ${rule.name}\n\n${rule.content}`).join("\n\n---\n\n");
	return `\n\n## Project Always-On Rules\n\n${sections}`;
}

export function buildScopedMutationPrimer(rules: Rule[]): string {
	if (rules.length === 0) {
		return "";
	}

	const items = rules.map((rule) => {
		const globs = rule.globs?.join(", ") ?? rule.relativePath;
		return `- ${rule.name} [scope: ${rule.scope}] -> ${globs}`;
	}).join("\n");

	return `\n\n## Scoped Mutation Rules\n\n`
		+ "Some project mutation rules are path-scoped and mandatory for matching edit/write calls. They are injected lazily and ephemerally only when a matching mutation is attempted.\n\n"
		+ "If edit/write is paused with SCOPED_RULES_PREPARED, this is normal control flow, not a failure. Do not apologize, do not ask the user to apply a diff manually, and do not claim tools are unavailable. Continue on the next model step after the scoped rules are injected.\n\n"
		+ "Only call edit/write for scoped paths from a model step where the matching scoped rules are visible.\n\n"
		+ `${items}`;
}

export function buildScopedReadPrimer(rules: Rule[]): string {
	if (rules.length === 0) {
		return "";
	}

	const items = rules.map((rule) => {
		const globs = rule.globs?.join(", ") ?? rule.relativePath;
		return `- ${rule.name} [scope: ${rule.scope}] -> ${globs}`;
	}).join("\n");

	return `\n\n## Scoped Read Rules\n\n`
		+ "Some project rules are path-scoped. Full scoped guidance is injected lazily for matching mutations and is not injected on every read, to avoid context bloat.\n\n"
		+ `${items}`;
}

export function buildModelDecisionPrompt(rules: Rule[]): string {
	if (rules.length === 0) {
		return "";
	}

	const items = rules.map((rule) => `- ${rule.name}: ${rule.description ?? rule.relativePath}`).join("\n");
	return `\n\n## Available Project Rules\n\n${items}`;
}

function normalizeLine(line: string): string {
	return line.replace(/\s+/g, " ").trim();
}

function isBoilerplateLine(line: string): boolean {
	return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(line));
}

function collectBulletLines(lines: string[]): string[] {
	return lines
		.filter((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))
		.map((line) => line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim())
		.filter((line) => line.length > 0)
		.map((line) => `- ${line}`);
}

function collectPlainGuidanceLines(lines: string[]): string[] {
	return lines
		.filter((line) => !line.startsWith("#"))
		.filter((line) => !/^[-*+]\s+/.test(line) && !/^\d+\.\s+/.test(line))
		.filter((line) => !isBoilerplateLine(line));
}

function condenseRuleContent(content: string): string {
	const normalizedLines = content
		.split("\n")
		.map(normalizeLine)
		.filter((line) => line.length > 0);

	const bulletLines = collectBulletLines(normalizedLines);
	const candidateLines = bulletLines.length > 0 ? bulletLines : collectPlainGuidanceLines(normalizedLines);

	const compactLines = [...new Set(candidateLines)].slice(0, DEFAULT_CONDENSED_RULE_LINES);
	if (compactLines.length === 0) {
		return normalizedLines.slice(0, DEFAULT_CONDENSED_RULE_LINES).join("\n");
	}

	const condensed = compactLines.join("\n");
	return candidateLines.length > DEFAULT_CONDENSED_RULE_LINES ? `${condensed}\n...` : condensed;
}

export function buildScopedPreparedReason(targetPath: string, scopes: string[]): string {
	const payload = {
		status: "normal_scoped_rules_preflight",
		targetPath,
		scopes,
		retryableNow: false,
		requiresNextModelCall: true,
	};

	return [
		"SCOPED_RULES_PREPARED",
		"status: normal_scoped_rules_preflight",
		"This is not an error. The attempted mutation targets a path covered by project scoped rules.",
		"The mutation was intentionally paused so the next model step can generate the change with the required rules visible.",
		"Do not apologize. Do not ask the user to apply a diff manually. Do not claim tools are unavailable.",
		"Do not retry this mutation in the same model step.",
		"Continue after the scoped rules are injected.",
		`target: ${targetPath}`,
		`matching_scopes: ${scopes.join(", ")}`,
		"retryable_now: false",
		"requires_next_model_call: true",
		"payload:",
		JSON.stringify(payload, null, 2),
	].join("\n");
}

export function buildScopedVisibilityFailureReason(targetPath: string, scopes: string[]): string {
	return [
		"SCOPED_RULES_VISIBILITY_FAILED",
		"status: scoped_rules_visibility_failed",
		"Scoped rules were queued for this mutation, but the extension could not confirm that they reached the provider request.",
		"Stopping this turn to avoid a repeated mutation loop.",
		`target: ${targetPath}`,
		`matching_scopes: ${scopes.join(", ")}`,
	].join("\n");
}

function buildScopedTransitionHeader(transition: ScopedTransitionNotice | undefined): string {
	const mandatoryGuidance = [
		"The following scoped project rules are mandatory for any edit/write to matching paths in this model step.",
		"Apply the matching rule body to generated code for files whose paths match the listed globs.",
		"Do not rely on earlier memory of these rules; use the rules visible in this message.",
		"The mutation gate only allows edit/write from a model step where the matching scoped rules are visible.",
	];

	if (!transition) {
		return [
			"[SCOPED PROJECT RULES ACTIVE]",
			...mandatoryGuidance,
		].join("\n");
	}

	if (transition.kind === "blocked") {
		return [
			transition.visibilityFailed
				? "[SCOPED PROJECT RULES: VISIBILITY CONFIRMATION FAILED]"
				: "[SCOPED PROJECT RULES: MUTATION PAUSED]",
			...mandatoryGuidance,
			`Blocked path: ${transition.targetPath}`,
			`Scopes: ${transition.scopes.join(", ")}`,
			"Use the scoped rules below on this model step that plans the mutation.",
		].join("\n");
	}

	return [
		"[SCOPED PROJECT RULES: MUTATION PREPARED]",
		...mandatoryGuidance,
		`Prepared path: ${transition.targetPath}`,
		`Prepared scopes: ${transition.scopes.join(", ")}`,
		"Use them on this model step to plan or apply the upcoming mutation.",
	].join("\n");
}

export function buildScopedContextMessage(
	rules: Rule[],
	renderMode: RuleRenderMode,
	nonce: string,
	transition?: ScopedTransitionNotice,
): EphemeralScopedContextMessage {
	const scopeList = [...new Set(rules.map((rule) => rule.scope))].join(", ");
	const renderedRules = rules
		.map((rule) => {
			const meta = rule.globs && rule.globs.length > 0 ? `\nGlobs: ${rule.globs.join(", ")}` : "";
			const body = renderMode === "condensed" ? condenseRuleContent(rule.content) : rule.content;
			return `### ${rule.name} [scope: ${rule.scope}]${meta}\n\n${body}`;
		})
		.join("\n\n---\n\n");

	return {
		role: "custom",
		customType: CONTEXT_MESSAGE_TYPE,
		content:
			`${buildScopedTransitionHeader(transition)}\n`
			+ `Scoped-Rules-Nonce: ${nonce}\n`
			+ `Render mode: ${renderMode}\n`
			+ `Active scopes: ${scopeList}\n\n`
			+ renderedRules,
		display: false,
		timestamp: Date.now(),
	};
}

export function stripScopedContextMessages(messages: AgentMessage[]): AgentMessage[] {
	return messages.filter((message) => !(message.role === "custom" && message.customType === CONTEXT_MESSAGE_TYPE));
}

function redactToolCallArguments(args: unknown, blocked: BlockedMutationToolCall): Record<string, unknown> {
	const original = args && typeof args === "object" ? args as Record<string, unknown> : {};
	return {
		path: original.path,
		paths: blocked.paths,
		blockedByScopedRules: true,
		scopes: blocked.scopes,
		argumentsRedacted: true,
	};
}

export function redactBlockedMutationToolCalls(messages: AgentMessage[], blockedToolCalls: Map<string, BlockedMutationToolCall>): AgentMessage[] {
	if (blockedToolCalls.size === 0) {
		return messages;
	}

	return messages.map((message) => {
		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			return message;
		}

		let changed = false;
		const content = message.content.map((block) => {
			const candidate = block as { type?: string; id?: string; arguments?: unknown };
			if (candidate.type !== "toolCall" || !candidate.id) {
				return block;
			}

			const blocked = blockedToolCalls.get(candidate.id);
			if (!blocked) {
				return block;
			}

			changed = true;
			return {
				...block,
				arguments: redactToolCallArguments(candidate.arguments, blocked),
			} as typeof block;
		});

		return changed ? { ...message, content } as AgentMessage : message;
	});
}
