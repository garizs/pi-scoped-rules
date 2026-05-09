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

export interface RuleDiagnostic {
	relativePath: string;
	message: string;
}

export interface RuleLoadResult {
	rules: Rule[];
	diagnostics: RuleDiagnostic[];
	revision: string;
}

export type RuleRenderMode = "full" | "condensed";

export type ScopedRuleEnforcementMode = "visible_in_current_context";

export interface ScopedRulesConfig {
	ruleDirs: string[];
	mutatingTools: ToolMutationSpec[];
	includeModelDecisionSummary: boolean;
	renderMode: RuleRenderMode;
	enforcementMode: ScopedRuleEnforcementMode;
}

export type ScopedTransitionNotice = {
	kind: "blocked";
	targetPath: string;
	scopes: string[];
	visibilityFailed?: boolean;
} | {
	kind: "prepared";
	targetPath: string;
	scopes: string[];
};

export interface ScopedMutationGateResult {
	allowed: boolean;
	matchingScopes: string[];
	missingVisibleScopes: string[];
	reason: "unscoped" | "visible" | "not_visible" | "visibility_failed" | "rules_changed";
}

export interface ScopedRulesInjection {
	providerCallId: number;
	nonce: string;
	scopes: string[];
	rulesRevision: string;
}

export interface ScopedRulesVisibility {
	providerCallId: number;
	nonce: string;
	scopes: string[];
	rulesRevision: string;
}

export interface ScopedMutationIntent {
	paths: string[];
	scopes: string[];
	remainingReinjections: number;
}

export interface BlockedMutationToolCall {
	toolName: string;
	paths: string[];
	scopes: string[];
}

export interface RuntimeState {
	config: ScopedRulesConfig;
	rules: Rule[];
	diagnostics: RuleDiagnostic[];
	rulesRevision: string;
	pendingScopes: Set<string>;
	providerCallSeq: number;
	currentProviderCallId?: number;
	inflightInjection?: ScopedRulesInjection;
	confirmedVisibility?: ScopedRulesVisibility;
	activeIntent?: ScopedMutationIntent;
	blockedToolCalls: Map<string, BlockedMutationToolCall>;
	lastBlockedPath?: string;
	lastBlockedScopes?: string[];
	lastVisibilityFailureKey?: string;
	visibilityFailureCount?: number;
	lastPreparedPath?: string;
	lastPreparedScopes?: string[];
}
