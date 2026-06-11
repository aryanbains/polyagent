import type {AgentDefinition} from '../agents/schema.js';

export type PlannerKind = 'single_agent' | 'plan_and_execute' | 'react' | 'sequential' | 'dynamic';
export type OrchestratorKind = 'single_agent' | 'multi_agent';

export type PlannerDescriptor = {
	kind: PlannerKind;
	name: string;
};

export type OrchestratorDescriptor = {
	kind: OrchestratorKind;
	name: string;
};

export type PlannerDecision = {
	id: string;
	agentName: string;
	task: string;
	reason: string;
	dependsOn?: string[];
};

export interface Planner {
	readonly descriptor: PlannerDescriptor;
	plan(task: string, agents: AgentDefinition[]): Promise<PlannerDecision[]>;
}

export interface Orchestrator {
	readonly descriptor: OrchestratorDescriptor;
}

export const singleAgentPlanner: PlannerDescriptor = {
	kind: 'single_agent',
	name: 'single-agent-planner'
};

export const singleAgentOrchestrator: OrchestratorDescriptor = {
	kind: 'single_agent',
	name: 'single-agent-orchestrator'
};

export const multiAgentOrchestrator: OrchestratorDescriptor = {
	kind: 'multi_agent',
	name: 'multi-agent-orchestrator'
};
