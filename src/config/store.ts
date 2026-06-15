import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scaffoldAgentsFile, type ScaffoldAgentsResult} from '../agents/scaffold.js';
import {CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME, type InitOptions, type PolyagentConfig} from '../domain.js';
import {decryptSecret, encryptSecret} from './crypto.js';

export class ConfigDecryptionError extends Error {
	constructor() {
		super('API key could not be decrypted. Run polyagent init to reconfigure.');
		this.name = 'ConfigDecryptionError';
	}
}

export function getPolyagentHome(): string {
	return process.env.POLYAGENT_HOME ?? path.join(os.homedir(), CONFIG_DIRECTORY_NAME);
}

export function getConfigPath(): string {
	return path.join(getPolyagentHome(), CONFIG_FILE_NAME);
}

export async function createConfig(options: InitOptions): Promise<PolyagentConfig> {
	const now = new Date().toISOString();
	const workingDirectory = path.resolve(options.workingDirectory);

	await mkdir(workingDirectory, {recursive: true});

	return {
		version: 1,
		project: {
			name: options.projectName.trim(),
			workingDirectory
		},
		llm: {
			provider: options.provider,
			apiKey: encryptSecret(options.apiKey?.trim() ?? '')
		},
		memory: {
			backend: options.memoryBackend
		},
		createdAt: now,
		updatedAt: now
	};
}

export async function saveConfig(config: PolyagentConfig): Promise<string> {
	const configPath = getConfigPath();
	await mkdir(path.dirname(configPath), {recursive: true});
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {mode: 0o600});
	return configPath;
}

export async function loadConfig(): Promise<PolyagentConfig | null> {
	try {
		const rawConfig = await readFile(getConfigPath(), 'utf8');
		const config = JSON.parse(rawConfig) as PolyagentConfig;

		try {
			decryptSecret(config.llm.apiKey);
		} catch {
			throw new ConfigDecryptionError();
		}

		return config;
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return null;
		}

		throw error;
	}
}

export function getConfigApiKey(config: PolyagentConfig): string {
	try {
		return decryptSecret(config.llm.apiKey);
	} catch {
		throw new ConfigDecryptionError();
	}
}

export type InitializeConfigResult = {
	config: PolyagentConfig;
	configPath: string;
	agentsFile: ScaffoldAgentsResult;
};

export async function initializeConfig(options: InitOptions): Promise<InitializeConfigResult> {
	const config = await createConfig(options);
	const configPath = await saveConfig(config);
	const agentsFile = await scaffoldAgentsFile(config.project.workingDirectory);
	return {config, configPath, agentsFile};
}
