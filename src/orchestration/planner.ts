import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {AgentDefinition, OrchestratorConfig} from '../agents/schema.js';
import type {PolycodeConfig} from '../domain.js';
import type {LlmClient} from '../chat/run.js';
import {isRunCancelled, throwIfAborted} from '../runtime/cancellation.js';
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
	source: 'static' | 'dynamic' | 'fallback';
};

const DynamicPlanStepSchema = z.object({
	id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
	title: z.string().min(1),
	agentName: z.string().min(1),
	prompt: z.string().min(1),
	dependsOn: z.array(z.string().min(1)).default([])
}).strict();

const DynamicPlanSchema = z.object({
	steps: z.array(DynamicPlanStepSchema).min(1).max(12)
}).strict();

export type DynamicPlanOptions = {
	config: PolycodeConfig;
	task: string;
	agents: AgentDefinition[];
	orchestrator: OrchestratorConfig;
	llmClient?: LlmClient;
	abortSignal?: AbortSignal;
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

function findAgentByNameOrFallback(agents: AgentDefinition[], name: string): AgentDefinition {
	return agents.find((agent) => agent.name === name) ?? agents[0]!;
}

function topologicalSortSteps(steps: MultiAgentPlanStep[]): MultiAgentPlanStep[] {
	const byId = new Map(steps.map((step) => [step.id, step]));
	const temporary = new Set<string>();
	const permanent = new Set<string>();
	const sorted: MultiAgentPlanStep[] = [];

	const visit = (step: MultiAgentPlanStep): void => {
		if (permanent.has(step.id)) {
			return;
		}

		if (temporary.has(step.id)) {
			throw new Error(`Plan contains a dependency cycle at ${step.id}.`);
		}

		temporary.add(step.id);

		for (const dependency of step.dependsOn) {
			const dependencyStep = byId.get(dependency);

			if (dependencyStep !== undefined) {
				visit(dependencyStep);
			}
		}

		temporary.delete(step.id);
		permanent.add(step.id);
		sorted.push(step);
	};

	for (const step of steps) {
		visit(step);
	}

	return sorted;
}

function normalizeDynamicSteps(rawSteps: Array<z.infer<typeof DynamicPlanStepSchema>>, agents: AgentDefinition[]): MultiAgentPlanStep[] {
	const usedIds = new Set<string>();
	const knownAgentNames = new Set(agents.map((agent) => agent.name));
	const normalized = rawSteps.map((step, index) => {
		const baseId = step.id.replaceAll(/[^a-zA-Z0-9_-]/g, '_') || `step_${index + 1}`;
		let id = baseId;
		let suffix = 2;

		while (usedIds.has(id)) {
			id = `${baseId}_${suffix}`;
			suffix += 1;
		}

		usedIds.add(id);
		const agent = knownAgentNames.has(step.agentName) ? findAgentByNameOrFallback(agents, step.agentName) : agents[Math.min(index, agents.length - 1)]!;
		return {
			id,
			title: step.title,
			agentName: agent.name,
			prompt: step.prompt,
			dependsOn: step.dependsOn,
			status: 'pending' as const
		};
	});
	const knownStepIds = new Set(normalized.map((step) => step.id));
	const steps = normalized.map((step) => ({
		...step,
		dependsOn: step.dependsOn.filter((dependency) => dependency !== step.id && knownStepIds.has(dependency))
	}));

	return topologicalSortSteps(steps);
}

function extractJsonObject(value: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(value);
	const raw = fenced?.[1] ?? value;
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');

	if (start === -1 || end === -1 || end <= start) {
		throw new Error('No JSON object found in dynamic planner response.');
	}

	return JSON.parse(raw.slice(start, end + 1));
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
		createdAt: new Date().toISOString(),
		source: orchestrator.strategy === 'dynamic' ? 'fallback' : 'static'
	};
}

export async function planMultiAgentTaskDynamically(options: DynamicPlanOptions): Promise<MultiAgentPlan> {
	throwIfAborted(options.abortSignal);

	if (options.agents.length === 0) {
		throw new Error('No agents are configured. Create agents.yaml and run polycode validate.');
	}

	if (options.orchestrator.strategy !== 'dynamic' || options.llmClient === undefined) {
		return planMultiAgentTask(options.task, options.agents, options.orchestrator);
	}

	const orchestratorAgent: AgentDefinition = {
		name: 'orchestrator',
		role: 'Planner that decomposes high-level tasks into dependency-aware subtasks for specialized agents',
		goal: 'Create the smallest useful multi-agent execution plan',
		tools: [],
		memory_enabled: false
	};
	const availableAgents = options.agents.map((agent) => `- ${agent.name}: ${agent.role}; goal: ${agent.goal}`).join('\n');
	const messages = [{
		role: 'user' as const,
		content: [
			`Task:\n${options.task}`,
			`Available agents:\n${availableAgents}`,
			'Return only JSON in this exact shape:',
			'{"steps":[{"id":"short_id","title":"Human title","agentName":"agent_name","prompt":"subtask prompt","dependsOn":["other_step_id"]}]}',
			`Use at most ${options.orchestrator.max_iterations} steps. Prefer parallel steps when dependencies are not required.`
		].join('\n\n')
	}];
	let response = '';

	try {
		for await (const token of options.llmClient.streamText({
			config: options.config,
			agent: orchestratorAgent,
			messages,
			system: 'You are Polycode dynamic planner. Produce valid JSON only. Do not write markdown or commentary.',
			abortSignal: options.abortSignal
		})) {
			throwIfAborted(options.abortSignal);
			response += token;
		}

		const parsed = DynamicPlanSchema.parse(extractJsonObject(response));
		const steps = normalizeDynamicSteps(parsed.steps, options.agents);

		return {
			id: randomUUID(),
			task: options.task,
			strategy: options.orchestrator.strategy,
			steps,
			createdAt: new Date().toISOString(),
			source: 'dynamic'
		};
	} catch (error) {
		if (isRunCancelled(error)) {
			throw error;
		}

		return planMultiAgentTask(options.task, options.agents, options.orchestrator);
	}
}
