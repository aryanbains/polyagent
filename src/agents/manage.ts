import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import {
	AgentConfigError,
	AgentDefinitionSchema,
	AgentsFileSchema,
	type AgentDefinition,
	type AgentsFile,
	type OrchestratorConfig
} from './schema.js';
import {resolveAgentsFile} from './load.js';

type SaveAgentsOptions = {
	workingDirectory: string;
	agents: AgentDefinition[];
	orchestrator?: OrchestratorConfig | null;
	filePath?: string | null;
};

type UpsertAgentOptions = {
	workingDirectory: string;
	agent: AgentDefinition;
	orchestrator?: OrchestratorConfig | null;
};

export type SaveAgentsResult = {
	filePath: string;
	agents: AgentDefinition[];
	orchestrator: OrchestratorConfig | null;
};

const defaultOrchestrator: OrchestratorConfig = {
	strategy: 'plan_and_execute',
	max_parallel_agents: 3,
	max_iterations: 10
};

function parseAgentsFile(rawConfig: string, filePath: string): unknown {
	if (filePath.endsWith('.json')) {
		return JSON.parse(rawConfig);
	}

	return yaml.load(rawConfig);
}

async function readExistingAgentsFile(workingDirectory: string): Promise<{filePath: string; data: AgentsFile} | null> {
	const filePath = await resolveAgentsFile(workingDirectory);

	if (filePath === null) {
		return null;
	}

	const parsed = parseAgentsFile(await readFile(filePath, 'utf8'), filePath);
	const result = AgentsFileSchema.safeParse(parsed);

	if (!result.success) {
		throw new AgentConfigError(`Cannot update ${path.basename(filePath)} until it validates. Run polyagent validate for details.`);
	}

	return {filePath, data: result.data};
}

function serializeAgentsFile(data: AgentsFile, filePath: string): string {
	if (filePath.endsWith('.json')) {
		return `${JSON.stringify(data, null, 2)}\n`;
	}

	return yaml.dump(data, {
		lineWidth: 100,
		noRefs: true,
		quotingType: '"'
	});
}

export async function saveAgentsFile(options: SaveAgentsOptions): Promise<SaveAgentsResult> {
	const filePath = options.filePath ?? path.join(options.workingDirectory, 'agents.yaml');
	const data = AgentsFileSchema.parse({
		orchestrator: options.orchestrator ?? defaultOrchestrator,
		agents: options.agents
	});

	await mkdir(path.dirname(filePath), {recursive: true});
	await writeFile(filePath, serializeAgentsFile(data, filePath));

	return {
		filePath,
		agents: data.agents,
		orchestrator: data.orchestrator ?? null
	};
}

export async function upsertAgentDefinition(options: UpsertAgentOptions): Promise<SaveAgentsResult> {
	const existing = await readExistingAgentsFile(options.workingDirectory);
	const agent = AgentDefinitionSchema.parse(options.agent);
	const existingAgents = existing?.data.agents ?? [];
	const nextAgents = existingAgents.some((candidate) => candidate.name === agent.name)
		? existingAgents.map((candidate) => candidate.name === agent.name ? agent : candidate)
		: [...existingAgents, agent];

	return saveAgentsFile({
		workingDirectory: options.workingDirectory,
		filePath: existing?.filePath ?? null,
		agents: nextAgents,
		orchestrator: existing?.data.orchestrator ?? options.orchestrator ?? defaultOrchestrator
	});
}
