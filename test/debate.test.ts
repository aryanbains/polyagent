import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {AgentDefinition, OrchestratorConfig} from '../src/agents/schema.js';
import type {LlmClient, LlmStreamOptions} from '../src/chat/run.js';
import type {PolyagentConfig} from '../src/domain.js';
import {applyModifications, runAgentDebate, type PlanModification} from '../src/orchestration/debate.js';
import type {MultiAgentPlan, MultiAgentPlanStep} from '../src/orchestration/planner.js';
import {runMultiAgentTask} from '../src/orchestration/run.js';

let workspace = '';

const agents: AgentDefinition[] = [
	{name: 'researcher', role: 'Research', goal: 'Research', tools: [], memory_enabled: false},
	{name: 'writer', role: 'Writer', goal: 'Write', tools: [], memory_enabled: false}
];

const orchestrator: OrchestratorConfig = {
	strategy: 'plan_and_execute',
	max_parallel_agents: 2,
	max_iterations: 10
};

function config(): PolyagentConfig {
	return {
		version: 1,
		project: {
			name: 'DebateTest',
			workingDirectory: workspace
		},
		llm: {
			provider: 'openai',
			apiKey: null
		},
		memory: {
			backend: 'skip'
		},
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	};
}

function step(id: string, agentName: string, dependsOn: string[] = []): MultiAgentPlanStep {
	return {
		id,
		title: `Step ${id}`,
		agentName,
		prompt: `Original prompt for ${id}`,
		dependsOn,
		status: 'pending'
	};
}

function plan(steps: MultiAgentPlanStep[] = [
	step('research', 'researcher'),
	step('draft', 'writer', ['research']),
	step('final', 'writer', ['draft'])
]): MultiAgentPlan {
	return {
		id: 'plan-1',
		task: 'Research and write',
		strategy: 'plan_and_execute',
		steps,
		createdAt: '2026-01-01T00:00:00.000Z',
		source: 'static'
	};
}

class DebateLlmClient implements LlmClient {
	readonly prompts: string[] = [];

	constructor(private readonly judgeJson = '{"approved":true,"summary":"Looks good","modifications":[]}') {}

	async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
		const lastMessage = options.messages.at(-1);
		this.prompts.push(typeof lastMessage?.content === 'string' ? lastMessage.content : '');

		if (options.agent.name === 'advocate') {
			yield '1. Strong agent fit\n2. Clear dependencies\n3. Useful prompts';
			return;
		}

		if (options.agent.name === 'skeptic') {
			yield '1. Draft prompt is underspecified\n2. Research needs source quality';
			return;
		}

		if (options.agent.name === 'judge') {
			yield this.judgeJson;
			return;
		}

		yield `executed by ${options.agent.name}`;
	}
}

beforeEach(async () => {
	workspace = await mkdtemp(path.join(os.tmpdir(), 'polyagent-debate-'));
});

afterEach(async () => {
	await rm(workspace, {force: true, recursive: true});
});

describe('agent debate', () => {
	it('returns an outcome with an approved boolean and rounds', async () => {
		const outcome = await runAgentDebate({
			plan: plan(),
			task: 'Research and write',
			config: config(),
			llmClient: new DebateLlmClient(),
			agents
		});

		expect(typeof outcome.approved).toBe('boolean');
		expect(outcome.rounds.length).toBeGreaterThan(0);
	});

	it('records four debate entries for a two-round debate', async () => {
		const outcome = await runAgentDebate({
			plan: plan(),
			task: 'Research and write',
			config: config(),
			llmClient: new DebateLlmClient(),
			agents,
			maxRounds: 2
		});

		expect(outcome.rounds.map((message) => `${message.role}-${message.round}`)).toEqual([
			'advocate-1',
			'skeptic-1',
			'advocate-2',
			'skeptic-2'
		]);
	});

	it('applies modify_prompt without mutating the original plan', () => {
		const original = plan();
		const result = applyModifications(original, [
			{type: 'modify_prompt', stepId: 'draft', value: 'New stronger draft prompt'}
		], agents);

		expect(result).not.toBe(original);
		expect(result.steps.find((step) => step.id === 'draft')?.prompt).toBe('New stronger draft prompt');
		expect(original.steps.find((step) => step.id === 'draft')?.prompt).toBe('Original prompt for draft');
	});

	it('ignores reassign_agent when the target agent does not exist', () => {
		const result = applyModifications(plan(), [
			{type: 'reassign_agent', stepId: 'draft', value: 'nonexistent'}
		], agents);

		expect(result.steps.find((step) => step.id === 'draft')?.agentName).toBe('writer');
	});

	it('adds a high-risk prefix to flagged prompts', () => {
		const result = applyModifications(plan(), [
			{type: 'flag_risk', stepId: 'research', value: 'source quality risk'}
		], agents);

		expect(result.steps.find((step) => step.id === 'research')?.prompt).toMatch(/^\[HIGH RISK\]/);
	});

	it('fires onDebateMessage once per debate message', async () => {
		let count = 0;

		await runAgentDebate({
			plan: plan(),
			task: 'Research and write',
			config: config(),
			llmClient: new DebateLlmClient(),
			agents,
			callbacks: {
				onDebateMessage: () => {
					count += 1;
				}
			}
		});

		expect(count).toBe(4);
	});

	it('fires onDebateEnd exactly once from the orchestration runner', async () => {
		let count = 0;

		await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research and write',
			approvalMode: 'allow',
			llmClient: new DebateLlmClient(),
			plan: plan(),
			enableDebate: true,
			saveSession: false,
			callbacks: {
				onDebateEnd: () => {
					count += 1;
				}
			}
		});

		expect(count).toBe(1);
	});

	it('skips debate for a single-step plan', async () => {
		let debateStarted = 0;
		const singleStepPlan = plan([step('only', 'researcher')]);
		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Do one thing',
			approvalMode: 'allow',
			llmClient: new DebateLlmClient(),
			plan: singleStepPlan,
			enableDebate: true,
			saveSession: false,
			callbacks: {
				onDebateStart: () => {
					debateStarted += 1;
				}
			}
		});

		expect(debateStarted).toBe(0);
		expect(result.plan.steps).toEqual(singleStepPlan.steps);
		expect(result.session.debateOutcome).toBeUndefined();
	});

	it('leaves the plan unchanged when modifications are empty', () => {
		const original = plan();
		const result = applyModifications(original, [] satisfies PlanModification[], agents);

		expect(result.steps).toEqual(original.steps);
		expect(result.steps).not.toBe(original.steps);
	});
});
