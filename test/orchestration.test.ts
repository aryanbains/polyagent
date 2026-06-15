import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {AgentDefinition, OrchestratorConfig} from '../src/agents/schema.js';
import {createAgentMessageBus} from '../src/orchestration/message-bus.js';
import {runMultiAgentTask} from '../src/orchestration/run.js';
import {loadRecordedSession} from '../src/orchestration/session-recorder.js';
import type {LlmClient, LlmStreamOptions} from '../src/chat/run.js';
import type {PolycodeConfig} from '../src/domain.js';

let workspace = '';

const agents: AgentDefinition[] = [
	{
		name: 'researcher',
		role: 'Research specialist',
		goal: 'Gather facts',
		tools: [],
		memory_enabled: false
	},
	{
		name: 'analyst',
		role: 'Analysis specialist',
		goal: 'Compare tradeoffs',
		tools: [],
		memory_enabled: false
	},
	{
		name: 'writer',
		role: 'Technical writer',
		goal: 'Write reports',
		tools: [],
		memory_enabled: false
	}
];

const orchestrator: OrchestratorConfig = {
	strategy: 'plan_and_execute',
	max_parallel_agents: 3,
	max_iterations: 10
};

function config(): PolycodeConfig {
	return {
		version: 1,
		project: {
			name: 'OrchestrationTest',
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

class DelayedLlmClient implements LlmClient {
	active = 0;
	maxActive = 0;
	readonly seen: string[] = [];

	constructor(private readonly delayMs = 30) {}

	async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
		this.active += 1;
		this.maxActive = Math.max(this.maxActive, this.active);

		try {
			const lastMessage = options.messages.at(-1);
			const content = typeof lastMessage?.content === 'string' ? lastMessage.content : 'message';
			this.seen.push(content);
			await new Promise((resolve) => {
				setTimeout(resolve, this.delayMs);
			});
			yield `completed ${content.includes('Research') ? 'research' : content.includes('Analyze') ? 'analysis' : 'synthesis'}`;
		} finally {
			this.active -= 1;
		}
	}
}

beforeEach(async () => {
	workspace = await mkdtemp(path.join(os.tmpdir(), 'polycode-orchestration-'));
});

afterEach(async () => {
	await rm(workspace, {force: true, recursive: true});
});

describe('Phase 4 orchestration', () => {
	it('validates and stores agent-to-agent request and response messages', () => {
		const bus = createAgentMessageBus();
		const request = bus.publish({
			from: 'writer',
			to: 'researcher',
			type: 'request',
			payload: {question: 'Need sources'}
		});
		const response = bus.publish({
			from: 'researcher',
			to: 'writer',
			type: 'response',
			payload: {answer: 'Sources ready'}
		});

		expect(request.timestamp).toBeInstanceOf(Date);
		expect(response.timestamp).toBeInstanceOf(Date);
		expect(bus.messagesFor('writer')).toHaveLength(2);
	});

	it('runs independent plan steps in parallel when max_parallel_agents allows it', async () => {
		const llmClient = new DelayedLlmClient();

		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research and compare JavaScript testing frameworks',
			approvalMode: 'allow',
			llmClient,
			saveSession: false
		});

		expect(result.success).toBe(true);
		expect(llmClient.maxActive).toBeGreaterThan(1);
		expect(result.session.messages.some((message) => message.type === 'request')).toBe(true);
		expect(result.session.messages.some((message) => message.type === 'response')).toBe(true);
	});

	it('uses an LLM-generated dynamic plan when strategy is dynamic', async () => {
		const llmClient: LlmClient = {
			async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
				if (options.agent.name === 'orchestrator') {
					yield JSON.stringify({
						steps: [
							{
								id: 'inspect_repo',
								title: 'Inspect repository structure',
								agentName: 'analyst',
								prompt: 'Inspect the repository and identify important files.',
								dependsOn: []
							},
							{
								id: 'write_summary',
								title: 'Write project summary',
								agentName: 'writer',
								prompt: 'Write a concise project summary using the inspection.',
								dependsOn: ['inspect_repo']
							}
						]
					});
					return;
				}

				yield `handled by ${options.agent.name}`;
			}
		};

		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator: {
				...orchestrator,
				strategy: 'dynamic'
			},
			task: 'Inspect this repository and write a summary',
			approvalMode: 'allow',
			llmClient,
			saveSession: false
		});

		expect(result.plan.source).toBe('dynamic');
		expect(result.plan.steps.map((step) => step.id)).toEqual(['inspect_repo', 'write_summary']);
		expect(result.session.messages.some((message) => message.from === 'writer' && message.to === 'analyst' && message.type === 'request')).toBe(true);
	});

	it('falls back to the static plan when dynamic planner output is malformed', async () => {
		const llmClient: LlmClient = {
			async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
				yield options.agent.name === 'orchestrator' ? 'not json' : 'fallback step output';
			}
		};

		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator: {
				...orchestrator,
				strategy: 'dynamic'
			},
			task: 'Do something open ended',
			approvalMode: 'allow',
			llmClient,
			saveSession: false
		});

		expect(result.plan.source).toBe('fallback');
		expect(result.plan.steps.map((step) => step.id)).toEqual(['research', 'analysis', 'synthesis']);
	});

	it('forces sequential execution when max_parallel_agents is 1', async () => {
		const llmClient = new DelayedLlmClient();

		await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator: {
				...orchestrator,
				max_parallel_agents: 1
			},
			task: 'Research and compare JavaScript testing frameworks',
			approvalMode: 'allow',
			llmClient,
			saveSession: false
		});

		expect(llmClient.maxActive).toBe(1);
	});

	it('falls back gracefully when one agent fails', async () => {
		const llmClient: LlmClient = {
			async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
				const lastMessage = options.messages.at(-1);
				const content = typeof lastMessage?.content === 'string' ? lastMessage.content : '';

				if (content.includes('Research')) {
					throw new Error('web search quota exceeded');
				}

				yield 'fallback output';
			}
		};

		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research and compare JavaScript testing frameworks',
			approvalMode: 'allow',
			llmClient,
			saveSession: false
		});

		expect(result.success).toBe(false);
		expect(result.finalOutput).toContain('web search quota exceeded');
		expect(result.session.steps.some((step) => step.status === 'failed')).toBe(true);
	});

	it('runs the demo flow and writes a markdown report', async () => {
		const llmClient = new DelayedLlmClient(1);

		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Research the top 5 JavaScript testing frameworks in 2024, compare their features, and create a markdown report at ./reports/testing-frameworks.md',
			approvalMode: 'allow',
			llmClient
		});
		const reportPath = path.join(workspace, 'reports', 'testing-frameworks.md');

		expect(result.success).toBe(true);
		expect(result.sessionPath).not.toBeNull();
		expect(existsSync(reportPath)).toBe(true);
		await expect(readFile(reportPath, 'utf8')).resolves.toContain('JavaScript testing frameworks');
	});

	it('creates default report and website artifacts without dumping raw code into final output', async () => {
		const llmClient: LlmClient = {
			async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
				if (options.agent.name === 'orchestrator') {
					yield 'not json';
					return;
				}

				yield [
					'Research notes ready.',
					'<html><body><script>console.log("should stay out of terminal");</script></body></html>',
					'function noisyCode() { return true; }'
				].join('\n');
			}
		};

		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator: {
				...orchestrator,
				strategy: 'dynamic'
			},
			task: 'search about cockroach janta party, make a report .md file, and a website too in html with embedded js and css',
			approvalMode: 'allow',
			llmClient,
			saveSession: false
		});
		const markdownPath = path.join(workspace, 'reports', 'cockroach-janta-party.md');
		const htmlPath = path.join(workspace, 'reports', 'cockroach-janta-party.html');

		expect(result.success).toBe(true);
		expect(result.artifacts).toEqual([
			path.join('reports', 'cockroach-janta-party.md'),
			path.join('reports', 'cockroach-janta-party.html')
		]);
		expect(existsSync(markdownPath)).toBe(true);
		expect(existsSync(htmlPath)).toBe(true);
		expect(result.finalOutput).toContain('Files');
		expect(result.finalOutput).not.toContain('<script>');
		expect(result.finalOutput).not.toContain('function noisyCode');
	});

	it('loads a recorded session for replay', async () => {
		const llmClient = new DelayedLlmClient(1);
		const result = await runMultiAgentTask({
			config: config(),
			agents,
			orchestrator,
			task: 'Inspect the repo and summarize files',
			approvalMode: 'allow',
			llmClient
		});

		const loaded = await loadRecordedSession(workspace, result.session.id);

		expect(loaded.session.id).toBe(result.session.id);
		expect(loaded.session.messages.length).toBeGreaterThan(0);
		expect(loaded.session.executionEvents.length).toBeGreaterThan(0);
	});
});
