import {randomUUID} from 'node:crypto';
import {stepCountIs, streamText, type ModelMessage, type ToolSet} from 'ai';
import type {AgentDefinition} from '../agents/schema.js';
import type {PolycodeConfig} from '../domain.js';
import {createLanguageModel} from '../llm/providers.js';
import {createMemoryStore} from '../memory/factory.js';
import type {MemoryStore} from '../memory/types.js';
import {RunCancelledError, isAbortLikeError, throwIfAborted} from '../runtime/cancellation.js';
import type {ToolContext} from '../tools/types.js';
import {createToolSet} from '../tools/registry.js';
import {
	createExecutionSession,
	createRunFinishedEvent,
	createRunStartedEvent,
	createToolFinishedEvent,
	createToolStartedEvent,
	type ExecutionSession,
	type RunningToolExecution
} from '../runtime/execution.js';
import {buildSystemPrompt} from './system-prompt.js';

export type LlmStreamOptions = {
	config: PolycodeConfig;
	agent: AgentDefinition;
	messages: ModelMessage[];
	system: string;
	tools?: ToolSet;
	abortSignal?: AbortSignal;
	onToolStart?: (toolName: string, input: unknown, toolCallId?: string) => void;
	onToolFinish?: (toolName: string, output: unknown, success: boolean, toolCallId?: string) => void;
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

function toLlmCallError(error: unknown): Error {
	if (error instanceof RunCancelledError || isAbortLikeError(error)) {
		return new RunCancelledError();
	}

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
		throwIfAborted(options.abortSignal);

		if (process.env.POLYCODE_MOCK_LLM_RESPONSE !== undefined) {
			yield process.env.POLYCODE_MOCK_LLM_RESPONSE;
			return;
		}

		try {
			const result = streamText({
				model: createLanguageModel(options.config, options.agent),
				system: options.system,
				messages: options.messages,
				tools: options.tools,
				abortSignal: options.abortSignal,
				stopWhen: stepCountIs(6),
				experimental_onToolCallStart: (event) => {
					options.onToolStart?.(event.toolCall.toolName, event.toolCall.input, event.toolCall.toolCallId);
				},
				experimental_onToolCallFinish: (event) => {
					options.onToolFinish?.(event.toolCall.toolName, event.success ? event.output : event.error, event.success, event.toolCall.toolCallId);
				}
			});

			for await (const chunk of result.textStream) {
				throwIfAborted(options.abortSignal);
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
	session?: ExecutionSession;
	toolContext?: ToolContext;
	abortSignal?: AbortSignal;
	onToken?: (token: string) => void;
	onToolStart?: (toolName: string, input: unknown) => void;
	onToolFinish?: (toolName: string, output: unknown, success: boolean) => void;
};

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<string> {
	throwIfAborted(options.abortSignal);
	const session = options.session ?? createExecutionSession();
	const runId = randomUUID();
	const runStepId = session.nextStepId();
	const runStartedAt = new Date().toISOString();
	const runStartedAtMs = Date.now();
	const memoryStore = options.memoryStore ?? createMemoryStore(options.config);
	const llmClient = options.llmClient ?? new AiSdkLlmClient();
	const memories = options.agent.memory_enabled ? await memoryStore.search(options.agent.name, options.message, 5) : [];
	throwIfAborted(options.abortSignal);
	const system = buildSystemPrompt(options.agent, memories);
	const conversation = options.conversation ?? [];
	const messages: ModelMessage[] = [
		...conversation,
		{role: 'user', content: options.message}
	];
	const tools = options.toolContext === undefined ? undefined : createToolSet(options.agent, {
		...options.toolContext,
		abortSignal: options.abortSignal ?? options.toolContext.abortSignal
	});
	let response = '';
	const runningTools = new Map<string, RunningToolExecution>();

	session.emit(createRunStartedEvent(session, runId, runStepId, options.agent.name, options.message));

	const startTool = (toolName: string, input: unknown, toolCallId = `${runId}:${toolName}:${runningTools.size + 1}`): void => {
		const {event, runningTool} = createToolStartedEvent(session, runId, options.agent.name, toolCallId, toolName, input);
		runningTools.set(toolCallId, runningTool);
		session.emit(event);
		options.onToolStart?.(toolName, input);
	};

	const finishTool = (toolName: string, output: unknown, success: boolean, toolCallId?: string): void => {
		const resolvedToolCallId = toolCallId ?? [...runningTools.values()].reverse().find((tool) => tool.toolName === toolName)?.toolCallId ?? `${runId}:${toolName}:unknown`;
		const runningTool = runningTools.get(resolvedToolCallId) ?? createToolStartedEvent(session, runId, options.agent.name, resolvedToolCallId, toolName, undefined).runningTool;
		session.emit(createToolFinishedEvent(session, runId, options.agent.name, runningTool, output, success));
		runningTools.delete(resolvedToolCallId);
		options.onToolFinish?.(toolName, output, success);
	};

	try {
		for await (const token of llmClient.streamText({
			config: options.config,
			agent: options.agent,
			messages,
			system,
			tools,
			abortSignal: options.abortSignal,
			onToolStart: startTool,
			onToolFinish: finishTool
		})) {
			throwIfAborted(options.abortSignal);
			response += token;
			options.onToken?.(token);
		}
	} catch (error) {
		session.emit(createRunFinishedEvent(
			session,
			runId,
			runStepId,
			options.agent.name,
			runStartedAt,
			runStartedAtMs,
			false,
			error instanceof Error ? error.message : String(error)
		));
		throw error;
	}

	conversation.push(
		{role: 'user', content: options.message},
		{role: 'assistant', content: response}
	);

	if (options.agent.memory_enabled) {
		throwIfAborted(options.abortSignal);
		await memoryStore.add(options.agent.name, `User: ${options.message}\nAssistant: ${response}`);
	}

	session.emit(createRunFinishedEvent(session, runId, runStepId, options.agent.name, runStartedAt, runStartedAtMs, true, response));

	return response;
}
