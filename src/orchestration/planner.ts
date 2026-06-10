import {randomUUID} from 'node:crypto';
import type {AgentDefinition, OrchestratorConfig} from '../agents/schema.js';
import type {PlannerDescriptor} from '../runtime/orchestration.js';

export type MultiAgentPlanStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type MultiAgentPlanStep = {
	id: string;
	title: string;
	agentName: string;
	prompt: string;
	dependsOn: string[];
	status: MultiAgentPlanStepStatus;
};

export type MultiAgentPlan = {
	id: string;
	task: string;
	strategy: OrchestratorConfig['strategy'];
	steps: MultiAgentPlanStep[];
	createdAt: string;
};

export function createPlannerDescriptor(orchestrator: OrchestratorConfig): PlannerDescriptor {
	return {
		kind: orchestrator.strategy,
		name: `${orchestrator.strategy}-planner`
	};
}

function scoreAgent(agent: AgentDefinition, patterns: RegExp[]): number {
	const haystack = `${agent.name} ${agent.role} ${agent.goal}`.toLowerCase();
	return patterns.reduce((score, pattern) => score + (pattern.test(haystack) ? 1 : 0), 0);
}

function chooseAgent(agents: AgentDefinition[], patterns: RegExp[], fallbackIndex: number): AgentDefinition {
	const ranked = [...agents].sort((a, b) => scoreAgent(b, patterns) - scoreAgent(a, patterns));
	return ranked[0] === undefined || scoreAgent(ranked[0], patterns) === 0 ? agents[Math.min(fallbackIndex, agents.length - 1)]! : ranked[0];
}

export function planMultiAgentTask(task: string, agents: AgentDefinition[], orchestrator: OrchestratorConfig): MultiAgentPlan {
	const id = randomUUID();

	if (agents.length === 0) {
		throw new Error('No agents are configured. Create agents.yaml and run polycode validate.');
	}

	const researcher = chooseAgent(agents, [/research/, /search/, /source/, /gather/], 0);
	const analyst = chooseAgent(agents, [/analy/, /compar/, /risk/, /tradeoff/], Math.min(1, agents.length - 1));
	const writer = chooseAgent(agents, [/writ/, /report/, /document/, /synth/], Math.min(2, agents.length - 1));
	const baseSteps: MultiAgentPlanStep[] = [
		{
			id: 'research',
			title: 'Research and gather source material',
			agentName: researcher.name,
			prompt: `Research and gather accurate source material for this task:\n${task}`,
			dependsOn: [],
			status: 'pending'
		},
		{
			id: 'analysis',
			title: 'Analyze findings and compare tradeoffs',
			agentName: analyst.name,
			prompt: `Analyze the task, identify comparison criteria, tradeoffs, risks, and useful structure:\n${task}`,
			dependsOn: [],
			status: 'pending'
		},
		{
			id: 'synthesis',
			title: 'Synthesize final answer or artifact',
			agentName: writer.name,
			prompt: `Synthesize the prior agent results into the final response or requested artifact:\n${task}`,
			dependsOn: ['research', 'analysis'],
			status: 'pending'
		}
	];

	const steps = baseSteps.map((step) => ({
		...step,
		dependsOn: step.dependsOn.filter((dependency) => baseSteps.some((candidate) => candidate.id === dependency))
	}));

	if (orchestrator.strategy === 'sequential' || orchestrator.max_parallel_agents === 1) {
		for (let index = 1; index < steps.length; index += 1) {
			steps[index] = {
				...steps[index]!,
				dependsOn: [steps[index - 1]!.id]
			};
		}
	}

	return {
		id,
		task,
		strategy: orchestrator.strategy,
		steps,
		createdAt: new Date().toISOString()
	};
}
