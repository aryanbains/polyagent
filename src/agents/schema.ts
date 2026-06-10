import {z} from 'zod';

export const AgentDefinitionSchema = z.object({
	name: z.string().min(1, 'Agent name is required').regex(/^[a-zA-Z0-9_-]+$/, 'Agent name can only contain letters, numbers, underscores, and dashes'),
	role: z.string().min(1, 'Agent role is required'),
	goal: z.string().min(1, 'Agent goal is required'),
	model: z.string().min(1, 'Agent model cannot be empty').optional(),
	tools: z.array(z.string().min(1)).default([]),
	memory_enabled: z.boolean().default(true),
	system_prompt: z.string().min(1, 'System prompt cannot be empty').optional()
}).strict();

export const OrchestratorConfigSchema = z.object({
	strategy: z.enum(['plan_and_execute', 'react', 'sequential']).default('plan_and_execute'),
	max_parallel_agents: z.number().int().positive().max(10).default(3),
	max_iterations: z.number().int().positive().max(100).default(10)
}).strict();

export const AgentsFileSchema = z.object({
	orchestrator: OrchestratorConfigSchema.optional(),
	agents: z.array(AgentDefinitionSchema).min(1, 'At least one agent must be defined')
}).strict();

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
export type AgentsFile = z.infer<typeof AgentsFileSchema>;

export class AgentConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AgentConfigError';
	}
}

export function formatAgentIssues(issues: z.ZodIssue[]): string {
	return issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join('.') : 'agents.yaml';
		return `${path}: ${issue.message}`;
	}).join('\n');
}
