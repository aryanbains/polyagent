import {tool, type ToolSet} from 'ai';
import type {AgentDefinition} from '../agents/schema.js';
import {getBuiltInToolDefinitions} from './builtins.js';
import type {ToolContext, ToolDefinition, ToolResult} from './types.js';

const TOOL_ALIASES: Record<string, string> = {
	file_read: 'read_file',
	file_write: 'write_file',
	shell: 'execute_command'
};

export function getToolDefinitions(): ToolDefinition[] {
	return getBuiltInToolDefinitions();
}

export function resolveToolNames(agent: AgentDefinition): string[] {
	const definitions = getToolDefinitions();
	const knownNames = new Set(definitions.map((definition) => definition.name));

	if (agent.tools.length === 0) {
		return [];
	}

	return agent.tools.map((name) => TOOL_ALIASES[name] ?? name).filter((name) => knownNames.has(name));
}

export function createToolSet(agent: AgentDefinition, context: ToolContext): ToolSet {
	const activeTools = new Set(resolveToolNames(agent));
	if (context.sendAgentMessage !== undefined) {
		activeTools.add('message_agent');
	}

	const entries = getToolDefinitions()
		.filter((definition) => activeTools.has(definition.name))
		.map((definition) => [
			definition.name,
			tool({
				description: definition.description,
				inputSchema: definition.inputSchema,
				execute: async (input, options): Promise<ToolResult> => definition.execute(input, {
					...context,
					abortSignal: options?.abortSignal ?? context.abortSignal
				})
			})
		]);

	return Object.fromEntries(entries) as ToolSet;
}

export function summarizeToolOutput(output: unknown): string {
	if (typeof output === 'object' && output !== null && 'message' in output) {
		const message = String((output as {message: unknown}).message);
		return message.length > 160 ? `${message.slice(0, 160)}...` : message;
	}

	const value = typeof output === 'string' ? output : JSON.stringify(output);
	return value.length > 160 ? `${value.slice(0, 160)}...` : value;
}
