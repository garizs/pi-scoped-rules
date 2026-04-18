export type RuleTrigger = "always_on" | "glob" | "model_decision";

export interface Rule {
	id: string;
	name: string;
	scope: string;
	trigger: RuleTrigger;
	description?: string;
	globs?: string[];
	content: string;
	sourcePath: string;
	relativePath: string;
}

export interface ToolMutationSpec {
	toolName: string;
	pathFields: string[];
}

export interface ScopedRulesConfig {
	ruleDirs: string[];
	mutatingTools: ToolMutationSpec[];
	includeModelDecisionSummary: boolean;
}

export interface RuntimeState {
	config: ScopedRulesConfig;
	rules: Rule[];
	activeScopes: Set<string>;
	lastBlockedPath?: string;
	lastBlockedScopes?: string[];
}
