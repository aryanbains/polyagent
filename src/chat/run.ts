import {streamText, type ModelMessage} from 'ai';
import type {AgentDefinition} from '../agents/schema.js';
import type {PolycodeConfig} from '../domain.js';
import {createLanguageModel} from '../llm/providers.js';
import {createMemoryStore} from '../memory/factory.js';
import type {MemoryStore} from '../memory/types.js';
import {buildSystemPrompt} from './system-prompt.js';

export type LlmStreamOptions = {
	config: PolycodeConfig;
	agent: AgentDefinition;
	messages: ModelMessage[];
	system: string;
};

export interface LlmClient {
	streamText(options: LlmStreamOptions): AsyncIterable<string>;
}

export class LlmCallError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LlmCallError';
	}
}

function toLlmCallError(error: unknown): LlmCallError {
	if (error instanceof LlmCallError) {
		return error;
	}

	const message = error instanceof Error ? error.message : String(error);

	if (/api key|authentication|unauthorized|401/i.test(message)) {
		return new LlmCallError('LLM request failed: authentication failed. Check your API key with polycode init.');
	}

	if (/rate limit|429|quota/i.test(message)) {
		return new LlmCallError('LLM request failed: the provider rate limit or quota was reached. Try again later or switch providers.');
	}

	if (/timeout|network|fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(message)) {
		return new LlmCallError('LLM request failed: the provider could not be reached. Check your network, provider endpoint, or local Ollama server.');
	}

	if (/model|not found|unsupported/i.test(message)) {
		return new LlmCallError(`LLM request failed: ${message}`);
	}

	return new LlmCallError(`LLM request failed: ${message}`);
}

export class AiSdkLlmClient implements LlmClient {
	async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
		if (process.env.POLYCODE_MOCK_LLM_RESPONSE !== undefined) {
			yield process.env.POLYCODE_MOCK_LLM_RESPONSE;
			return;
		}

		try {
			const result = streamText({
				model: createLanguageModel(options.config, options.agent),
				system: options.system,
				messages: options.messages
			});

			for await (const chunk of result.textStream) {
				yield chunk;
			}
		} catch (error) {
			throw toLlmCallError(error);
		}
	}
}

export type RunAgentTurnOptions = {
	config: PolycodeConfig;
	agent: AgentDefinition;
	message: string;
	conversation?: ModelMessage[];
	memoryStore?: MemoryStore;
	llmClient?: LlmClient;
	onToken?: (token: string) => void;
};

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<string> {
	const memoryStore = options.memoryStore ?? createMemoryStore(options.config);
	const llmClient = options.llmClient ?? new AiSdkLlmClient();
	const memories = options.agent.memory_enabled ? await memoryStore.search(options.agent.name, options.message, 5) : [];
	const system = buildSystemPrompt(options.agent, memories);
	const conversation = options.conversation ?? [];
	const messages: ModelMessage[] = [
		...conversation,
		{role: 'user', content: options.message}
	];
	let response = '';

	for await (const token of llmClient.streamText({
		config: options.config,
		agent: options.agent,
		messages,
		system
	})) {
		response += token;
		options.onToken?.(token);
	}

	conversation.push(
		{role: 'user', content: options.message},
		{role: 'assistant', content: response}
	);

	if (options.agent.memory_enabled) {
		await memoryStore.add(options.agent.name, `User: ${options.message}\nAssistant: ${response}`);
	}

	return response;
}
