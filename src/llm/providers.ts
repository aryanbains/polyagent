import type {LanguageModel} from 'ai';
import {createAnthropic} from '@ai-sdk/anthropic';
import {createGroq} from '@ai-sdk/groq';
import {createOpenAI} from '@ai-sdk/openai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import type {AgentDefinition} from '../agents/schema.js';
import type {PolycodeConfig, Provider} from '../domain.js';
import {getConfigApiKey} from '../config/store.js';

const DEFAULT_MODELS: Record<Provider, string> = {
	openai: 'gpt-4o-mini',
	anthropic: 'claude-3-5-haiku-latest',
	groq: 'llama-3.1-8b-instant',
	ollama: 'llama3.1'
};

export class ProviderConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProviderConfigurationError';
	}
}

export function createLanguageModel(config: PolycodeConfig, agent: AgentDefinition): LanguageModel {
	const model = agent.model ?? DEFAULT_MODELS[config.llm.provider];
	const apiKey = getConfigApiKey(config);

	if (config.llm.provider !== 'ollama' && apiKey.length === 0) {
		throw new ProviderConfigurationError(`No API key configured for ${config.llm.provider}. Run polycode init to reconfigure.`);
	}

	if (config.llm.provider === 'openai') {
		return createOpenAI({apiKey})(model);
	}

	if (config.llm.provider === 'anthropic') {
		return createAnthropic({apiKey})(model);
	}

	if (config.llm.provider === 'groq') {
		return createGroq({apiKey})(model);
	}

	return createOpenAICompatible({
		name: 'ollama',
		baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
		apiKey: apiKey || 'ollama'
	})(model);
}
