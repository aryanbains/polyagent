import {streamText} from 'ai';
import type {AgentDefinition} from '../agents/schema.js';
import type {PolycodeConfig} from '../domain.js';
import {createLanguageModel} from '../llm/providers.js';
import {createMemoryStore} from '../memory/factory.js';
import type {MemoryStore} from '../memory/types.js';
import {buildSystemPrompt} from './system-prompt.js';

export type LlmStreamOptions = {
	config: PolycodeConfig;
	agent: AgentDefinition;
	message: string;
	system: string;
};

export interface LlmClient {
	streamText(options: LlmStreamOptions): AsyncIterable<string>;
}

export class AiSdkLlmClient implements LlmClient {
	async *streamText(options: LlmStreamOptions): AsyncIterable<string> {
		if (process.env.POLYCODE_MOCK_LLM_RESPONSE !== undefined) {
			yield process.env.POLYCODE_MOCK_LLM_RESPONSE;
			return;
		}

		const result = streamText({
			model: createLanguageModel(options.config, options.agent),
			system: options.system,
			prompt: options.message
		});

		for await (const chunk of result.textStream) {
			yield chunk;
		}
	}
}

export type RunAgentTurnOptions = {
	config: PolycodeConfig;
	agent: AgentDefinition;
	message: string;
	memoryStore?: MemoryStore;
	llmClient?: LlmClient;
	onToken?: (token: string) => void;
};

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<string> {
	const memoryStore = options.memoryStore ?? createMemoryStore(options.config);
	const llmClient = options.llmClient ?? new AiSdkLlmClient();
	const memories = options.agent.memory_enabled ? await memoryStore.search(options.agent.name, options.message, 5) : [];
	const system = buildSystemPrompt(options.agent, memories);
	let response = '';

	for await (const token of llmClient.streamText({
		config: options.config,
		agent: options.agent,
		message: options.message,
		system
	})) {
		response += token;
		options.onToken?.(token);
	}

	if (options.agent.memory_enabled) {
		await memoryStore.add(options.agent.name, `User: ${options.message}\nAssistant: ${response}`);
	}

	return response;
}
