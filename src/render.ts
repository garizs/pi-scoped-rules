import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Rule, RuleRenderMode } from "./types.js";

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

export function buildScopedContextMessage(rules: Rule[], renderMode: RuleRenderMode): EphemeralScopedContextMessage {
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
			`[SCOPED PROJECT RULES ACTIVE]\n`
			+ `Apply these project rules to any upcoming file mutations in this agent run.\n`
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
