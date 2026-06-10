import {describe, expect, it} from 'vitest';
import type {AgentDefinition} from '../src/agents/schema.js';
import {runAgentTurn, type LlmClient, type LlmStreamOptions} from '../src/chat/run.js';
import type {PolycodeConfig} from '../src/domain.js';
import {LocalVectorMemoryStore} from '../src/memory/local-store.js';
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

	async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
		this.systems.push(options.system);
		yield `response to ${options.message}`;
	}
}

describe('runAgentTurn', () => {
	it('stores exchanges and injects relevant memory on later turns', async () => {
		const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'polycode-chat-'));
		const memoryStore = LocalVectorMemoryStore.forProject(temporaryDirectory);
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
});
