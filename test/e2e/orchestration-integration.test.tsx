import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {AgentDefinition, OrchestratorConfig} from '../../src/agents/schema.js';
import type {LlmClient, LlmStreamOptions} from '../../src/chat/run.js';
import type {PolycodeConfig} from '../../src/domain.js';
import type {MultiAgentPlan} from '../../src/orchestration/planner.js';
import {loadRecordedSession} from '../../src/orchestration/session-recorder.js';
import {runMultiAgentTask} from '../../src/orchestration/run.js';
import {TaskGraph} from '../../src/ui/TaskGraph.js';

let workspace = '';

const agents: AgentDefinition[] = [
	{name: 'researcher', role: 'Researcher', goal: 'Gather facts', tools: [], memory_enabled: false},
	{name: 'writer', role: 'Writer', goal: 'Write output', tools: [], memory_enabled: false}
];

const orchestrator: OrchestratorConfig = {
	strategy: 'plan_and_execute',
	max_parallel_agents: 2,
	max_iterations: 10
};

const basePlan: MultiAgentPlan = {
	id: 'integration-plan',
	task: 'Research and write',
	strategy: 'plan_and_execute',
	createdAt: '2026-01-01T00:00:00.000Z',
	source: 'static',
	steps: [
		{
			id: 'research',
			title: 'Research',
			agentName: 'researcher',
			prompt: 'Original research prompt',
			dependsOn: [],
			status: 'pending'
		},
		{
			id: 'write',
			title: 'Write',
			agentName: 'writer',
			prompt: 'Original writer prompt',
			dependsOn: ['research'],
			status: 'pending'
		}
	]
};

function config(): PolycodeConfig {
	return {
		version: 1,
		project: {
			name: 'Integration',
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

class IntegrationLlmClient implements LlmClient {
	readonly executionPrompts: string[] = [];

	constructor(
		private readonly judgeJson = '{"approved":true,"summary":"No changes","modifications":[]}',
		private readonly failDebate = false
	) {}

	async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
		const lastMessage = options.messages.at(-1);
		const content = typeof lastMessage?.content === 'string' ? lastMessage.content : '';

		if (options.agent.name === 'advocate') {
			if (this.failDebate) {
				throw new Error('debate network failure');
			}

			yield '1. Agents match the work\n2. Dependencies are clear\n3. Prompts are usable';
			return;
		}

		if (options.agent.name === 'skeptic') {
			yield '1. Writer prompt needs a stricter outline\n2. Research needs source quality';
			return;
		}

		if (options.agent.name === 'judge') {
			yield this.judgeJson;
			return;
		}

		this.executionPrompts.push(content);
		yield `executed ${options.agent.name}`;
	}
}

beforeEach(async () => {
	workspace = await mkdtemp(path.join(os.tmpdir(), 'polycode-integration-'));
});

afterEach(async () => {
	cleanup();
	await rm(workspace, {force: true, recursive: true});
});

describe('orchestration integration', () => {
	it('runs debate, renders a graph for approval, executes both agents, and saves debate in the session', async () => {
		let graphFrame = '';
		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research and write',
			approvalMode: 'allow',
			llmClient: new IntegrationLlmClient(),
			plan: basePlan,
			enableDebate: true,
			callbacks: {
				onPlan: (plan) => {
					const view = render(<TaskGraph interactive={false} plan={plan} onApprove={() => {}} onEdit={() => {}} onReplan={() => {}} />);
					graphFrame = view.lastFrame() ?? '';
					return plan;
				}
			}
		});
		const loaded = await loadRecordedSession(workspace, result.session.id);

		expect(graphFrame).toContain('Wave 1');
		expect(result.sessionPath).not.toBeNull();
		expect(existsSync(result.sessionPath ?? '')).toBe(true);
		expect(result.session.steps).toHaveLength(2);
		expect(result.session.steps.every((step) => step.status === 'succeeded')).toBe(true);
		expect(loaded.session.debateOutcome?.rounds).toHaveLength(4);
		expect(loaded.session.plan.steps.map((step) => step.id)).toEqual(['research', 'write']);
	});

	it('uses a judge modify_prompt change during actual execution', async () => {
		const llmClient = new IntegrationLlmClient(JSON.stringify({
			approved: true,
			summary: 'Strengthen writer prompt',
			modifications: [
				{type: 'modify_prompt', stepId: 'write', value: 'Modified writer prompt from debate'}
			]
		}));

		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research and write',
			approvalMode: 'allow',
			llmClient,
			plan: basePlan,
			enableDebate: true,
			saveSession: false,
			callbacks: {
				onPlan: (plan) => plan
			}
		});

		expect(result.plan.steps.find((step) => step.id === 'write')?.prompt).toBe('Modified writer prompt from debate');
		expect(llmClient.executionPrompts.some((prompt) => prompt.includes('Modified writer prompt from debate'))).toBe(true);
	});

	it('lets graph edits win over debate modifications', async () => {
		const llmClient = new IntegrationLlmClient(JSON.stringify({
			approved: true,
			summary: 'Strengthen writer prompt',
			modifications: [
				{type: 'modify_prompt', stepId: 'write', value: 'Debate-modified writer prompt'}
			]
		}));

		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research and write',
			approvalMode: 'allow',
			llmClient,
			plan: basePlan,
			enableDebate: true,
			saveSession: false,
			callbacks: {
				onPlan: (plan) => ({
					...plan,
					steps: plan.steps.map((step) => step.id === 'write' ? {...step, prompt: 'User-edited writer prompt'} : step)
				})
			}
		});

		expect(result.plan.steps.find((step) => step.id === 'write')?.prompt).toBe('User-edited writer prompt');
		expect(llmClient.executionPrompts.some((prompt) => prompt.includes('User-edited writer prompt'))).toBe(true);
		expect(llmClient.executionPrompts.some((prompt) => prompt.includes('Debate-modified writer prompt'))).toBe(false);
	});

	it('records replay-critical debate and plan data in saved session JSON', async () => {
		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research and write',
			approvalMode: 'allow',
			llmClient: new IntegrationLlmClient(),
			plan: basePlan,
			enableDebate: true
		});
		const rawSession = await readFile(result.sessionPath ?? '', 'utf8');
		const loaded = JSON.parse(rawSession) as {debateOutcome?: {rounds: unknown[]}; plan?: {steps: unknown[]}; stats?: {toolsCalled: number}};

		expect(loaded.debateOutcome?.rounds).toHaveLength(4);
		expect(loaded.plan?.steps).toHaveLength(2);
		expect(typeof loaded.stats?.toolsCalled).toBe('number');
	});

	it('skips debate for a single-step plan but still exposes the graph approval callback', async () => {
		let onPlanCalls = 0;
		const singleStepPlan: MultiAgentPlan = {
			...basePlan,
			steps: [basePlan.steps[0]!]
		};
		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research only',
			approvalMode: 'allow',
			llmClient: new IntegrationLlmClient(),
			plan: singleStepPlan,
			enableDebate: true,
			saveSession: false,
			callbacks: {
				onPlan: (plan) => {
					onPlanCalls += 1;
					return plan;
				}
			}
		});

		expect(onPlanCalls).toBe(1);
		expect(result.session.debateOutcome).toBeUndefined();
	});

	it('continues to execution if debate fails', async () => {
		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research and write',
			approvalMode: 'allow',
			llmClient: new IntegrationLlmClient(undefined, true),
			plan: basePlan,
			enableDebate: true,
			saveSession: false,
			callbacks: {
				onPlan: (plan) => plan
			}
		});

		expect(result.session.steps).toHaveLength(2);
		expect(result.session.steps.every((step) => step.status === 'succeeded')).toBe(true);
		expect(result.session.debateOutcome?.summary).toContain('Plan review failed');
	});
});
