import {describe, expect, it} from 'vitest';
import type {AgentDefinition} from '../src/agents/schema.js';
import {AiSdkLlmClient, LlmCallError, runAgentTurn, type LlmClient, type LlmStreamOptions} from '../src/chat/run.js';
import type {PolycodeConfig} from '../src/domain.js';
import {LocalVectorMemoryStore} from '../src/memory/local-store.js';
import {HashEmbedder} from '../src/memory/embedder.js';
import {createExecutionSession} from '../src/runtime/execution.js';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const agent: AgentDefinition = {
	name: 'researcher',
	role: 'Research specialist',
	goal: 'Find accurate information',
	tools: [],
	memory_enabled: true
};

const config: PolycodeConfig = {
	version: 1,
	project: {
		name: 'Demo',
		workingDirectory: process.cwd()
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

class RecordingLlmClient implements LlmClient {
	systems: string[] = [];
	messages: LlmStreamOptions['messages'][] = [];

	async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
		this.systems.push(options.system);
		this.messages.push(options.messages);
		const lastMessage = options.messages.at(-1);
		yield `response to ${typeof lastMessage?.content === 'string' ? lastMessage.content : 'message'}`;
	}
}

describe('runAgentTurn', () => {
	it('stores exchanges and injects relevant memory on later turns', async () => {
		const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'polycode-chat-'));
		const memoryStore = new LocalVectorMemoryStore(path.join(temporaryDirectory, '.polycode', 'memory.json'), new HashEmbedder());
		const llmClient = new RecordingLlmClient();

		try {
			await runAgentTurn({
				config,
				agent,
				message: 'Remember that we discussed Vitest.',
				memoryStore,
				llmClient
			});
			await runAgentTurn({
				config,
				agent,
				message: 'What did we discuss about testing?',
				memoryStore,
				llmClient
			});

			expect(llmClient.systems[1]).toContain('Relevant memory');
			expect(llmClient.systems[1]).toContain('Vitest');
		} finally {
			await rm(temporaryDirectory, {force: true, recursive: true});
		}
	});

	it('passes in-session conversation history to the LLM', async () => {
		const llmClient = new RecordingLlmClient();
		const conversation: LlmStreamOptions['messages'] = [];
		const agentWithoutMemory = {
			...agent,
			memory_enabled: false
		};

		await runAgentTurn({
			config,
			agent: agentWithoutMemory,
			message: 'My project codename is Cedar.',
			conversation,
			llmClient
		});
		await runAgentTurn({
			config,
			agent: agentWithoutMemory,
			message: 'What is the codename?',
			conversation,
			llmClient
		});

		expect(llmClient.messages[1]).toEqual([
			{role: 'user', content: 'My project codename is Cedar.'},
			{role: 'assistant', content: 'response to My project codename is Cedar.'},
			{role: 'user', content: 'What is the codename?'}
		]);
	});

	it('passes tool callbacks through the LLM client', async () => {
		const events: string[] = [];
		const llmClient: LlmClient = {
			async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
				options.onToolStart?.('read_file', {path: 'package.json'});
				options.onToolFinish?.('read_file', {ok: true, message: 'package contents'}, true);
				yield 'done';
			}
		};

		await runAgentTurn({
			config,
			agent: {
				...agent,
				memory_enabled: false,
				tools: ['read_file']
			},
			message: 'read package.json',
			llmClient,
			toolContext: {
				workingDirectory: process.cwd(),
				approvalMode: 'deny'
			},
			onToolStart: (toolName) => {
				events.push(`start:${toolName}`);
			},
			onToolFinish: (toolName) => {
				events.push(`finish:${toolName}`);
			}
		});

		expect(events).toEqual(['start:read_file', 'finish:read_file']);
	});

	it('records structured execution events for runs and tool calls', async () => {
		const session = createExecutionSession();
		const llmClient: LlmClient = {
			async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
				options.onToolStart?.('read_file', {path: 'package.json'}, 'tool-call-1');
				options.onToolFinish?.('read_file', {ok: true, message: 'package contents'}, true, 'tool-call-1');
				yield 'done';
			}
		};

		await runAgentTurn({
			config,
			agent: {
				...agent,
				memory_enabled: false,
				tools: ['read_file']
			},
			message: 'read package.json',
			llmClient,
			session,
			toolContext: {
				workingDirectory: process.cwd(),
				approvalMode: 'deny'
			}
		});

		expect(session.planner.kind).toBe('single_agent');
		expect(session.orchestrator.kind).toBe('single_agent');
		expect(session.events.map((event) => event.type)).toEqual([
			'run_started',
			'tool_started',
			'tool_finished',
			'run_finished'
		]);
		expect(session.events[0]).toMatchObject({
			agentName: 'researcher',
			stepId: 'step-1',
			status: 'started'
		});
		expect(session.events[1]).toMatchObject({
			agentName: 'researcher',
			stepId: 'step-2',
			toolName: 'read_file',
			toolCallId: 'tool-call-1',
			input: {path: 'package.json'}
		});
		expect(session.events[2]).toMatchObject({
			agentName: 'researcher',
			stepId: 'step-2',
			toolName: 'read_file',
			success: true,
			status: 'succeeded'
		});
		expect(session.events[2]).toHaveProperty('durationMs');
		expect(session.events[2]).toHaveProperty('startedAt');
		expect(session.events[2]).toHaveProperty('completedAt');
		expect(session.events[3]).toMatchObject({
			agentName: 'researcher',
			stepId: 'step-1',
			success: true,
			status: 'succeeded'
		});
	});

	it('normalizes provider failures into friendly LLM call errors', async () => {
		const llmClient = new AiSdkLlmClient();

		await expect(async () => {
			for await (const _token of llmClient.streamText({
				config,
				agent,
				messages: [{role: 'user', content: 'hello'}],
				system: 'test'
			})) {
				// consume stream
			}
		}).rejects.toThrow(LlmCallError);
	});
});
