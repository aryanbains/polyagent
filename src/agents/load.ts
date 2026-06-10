import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import {AgentConfigError, AgentsFileSchema, formatAgentIssues, type AgentDefinition} from './schema.js';

type LoadAgentsOptions = {
	workingDirectory: string;
	filePath?: string;
	requireFile?: boolean;
};

export type LoadedAgents = {
	agents: AgentDefinition[];
	filePath: string | null;
};

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function resolveAgentsFile(workingDirectory: string, filePath?: string): Promise<string | null> {
	if (filePath !== undefined) {
		return path.resolve(workingDirectory, filePath);
	}

	const candidates = [
		path.join(workingDirectory, 'agents.yaml'),
		path.join(workingDirectory, 'agents.yml'),
		path.join(workingDirectory, 'agents.json')
	];

	for (const candidate of candidates) {
		if (await fileExists(candidate)) {
			return candidate;
		}
	}

	return null;
}

function parseAgentsFile(rawConfig: string, filePath: string): unknown {
	if (filePath.endsWith('.json')) {
		return JSON.parse(rawConfig);
	}

	return yaml.load(rawConfig);
}

export async function loadAgents(options: LoadAgentsOptions): Promise<LoadedAgents> {
	const agentsFile = await resolveAgentsFile(options.workingDirectory, options.filePath);

	if (agentsFile === null) {
		if (options.requireFile) {
			throw new AgentConfigError(`No agents.yaml, agents.yml, or agents.json found in ${options.workingDirectory}.`);
		}

		return {agents: [], filePath: null};
	}

	let parsedConfig: unknown;

	try {
		parsedConfig = parseAgentsFile(await readFile(agentsFile, 'utf8'), agentsFile);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new AgentConfigError(`Could not parse ${agentsFile}: ${message}`);
	}

	const result = AgentsFileSchema.safeParse(parsedConfig);

	if (!result.success) {
		throw new AgentConfigError(`Invalid ${path.basename(agentsFile)}:\n${formatAgentIssues(result.error.issues)}`);
	}

	return {
		agents: result.data.agents,
		filePath: agentsFile
	};
}

export function findAgent(agents: AgentDefinition[], name: string): AgentDefinition {
	const agent = agents.find((candidate) => candidate.name === name);

	if (agent === undefined) {
		throw new AgentConfigError(`Agent "${name}" was not found. Run polycode validate to see configured agents.`);
	}

	return agent;
}
