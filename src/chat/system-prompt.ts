import type {AgentDefinition} from '../agents/schema.js';
import type {MemorySearchResult} from '../memory/types.js';

export function buildSystemPrompt(agent: AgentDefinition, memories: MemorySearchResult[]): string {
	const basePrompt = agent.system_prompt ?? [
		`You are ${agent.name}.`,
		`Role: ${agent.role}`,
		`Goal: ${agent.goal}`,
		agent.tools.length > 0 ? `Available tools: ${agent.tools.join(', ')}` : 'No tools are available yet.'
	].join('\n');

	if (memories.length === 0) {
		return basePrompt;
	}

	const memoryBlock = memories.map((memory, index) => {
		return `${index + 1}. ${memory.record.content}`;
	}).join('\n');

	return `${basePrompt}\n\nRelevant memory from previous conversations:\n${memoryBlock}`;
}
