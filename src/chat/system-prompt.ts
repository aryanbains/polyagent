import type {AgentDefinition} from '../agents/schema.js';
import type {MemorySearchResult} from '../memory/types.js';

function formatCurrentDate(now: Date): string {
	return now.toISOString().slice(0, 10);
}

export function buildSystemPrompt(agent: AgentDefinition, memories: MemorySearchResult[], now = new Date()): string {
	const agentPrompt = agent.system_prompt ?? [
		`You are ${agent.name}.`,
		`Role: ${agent.role}`,
		`Goal: ${agent.goal}`,
		agent.tools.length > 0 ? `Available tools: ${agent.tools.join(', ')}` : 'No tools are available yet.'
	].join('\n');
	const basePrompt = [
		`Current date: ${formatCurrentDate(now)}.`,
		agentPrompt,
		agent.tools.includes('web_search') || agent.tools.includes('fetch_url')
			? 'For current, latest, price, news, office-holder, or time-sensitive factual questions, use web tools before giving the answer. Use the current date/year in search queries. Do not answer from memory first and then verify afterward.'
			: undefined
	].filter(Boolean).join('\n');

	if (memories.length === 0) {
		return basePrompt;
	}

	const memoryBlock = memories.map((memory, index) => {
		return `${index + 1}. ${memory.record.content}`;
	}).join('\n');

	return `${basePrompt}\n\nRelevant memory from previous conversations:\n${memoryBlock}`;
}
