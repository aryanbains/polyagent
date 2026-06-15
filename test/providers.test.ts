import {describe, expect, it} from 'vitest';
import type {AgentDefinition} from '../src/agents/schema.js';
import {encryptSecret} from '../src/config/crypto.js';
import type {PolyagentConfig} from '../src/domain.js';
import {createLanguageModel} from '../src/llm/providers.js';

const agent: AgentDefinition = {
	name: 'researcher',
	role: 'Research specialist',
	goal: 'Find accurate information',
	model: 'deepseek/deepseek-v4-pro',
	tools: [],
	memory_enabled: true
};

describe('createLanguageModel', () => {
	it('creates an OpenRouter model through the OpenAI-compatible adapter', () => {
		const config: PolyagentConfig = {
			version: 1,
			project: {
				name: 'Demo',
				workingDirectory: process.cwd()
			},
			llm: {
				provider: 'openrouter',
				apiKey: encryptSecret('test-openrouter-key')
			},
			memory: {
				backend: 'skip'
			},
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		};

		const model = createLanguageModel(config, agent);
		const modelInfo = model as {provider: string; modelId: string};

		expect(modelInfo.provider).toContain('openrouter');
		expect(modelInfo.modelId).toBe('deepseek/deepseek-v4-pro');
	});
});
