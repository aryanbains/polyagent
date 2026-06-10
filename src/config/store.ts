import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME, type InitOptions, type PolycodeConfig} from '../domain.js';
import {decryptSecret, encryptSecret} from './crypto.js';

export class ConfigDecryptionError extends Error {
	constructor() {
		super('API key could not be decrypted. Run polycode init to reconfigure.');
		this.name = 'ConfigDecryptionError';
	}
}

export function getPolycodeHome(): string {
	return process.env.POLYCODE_HOME ?? path.join(os.homedir(), CONFIG_DIRECTORY_NAME);
}

export function getConfigPath(): string {
	return path.join(getPolycodeHome(), CONFIG_FILE_NAME);
}

export async function createConfig(options: InitOptions): Promise<PolycodeConfig> {
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

export async function saveConfig(config: PolycodeConfig): Promise<string> {
	const configPath = getConfigPath();
	await mkdir(path.dirname(configPath), {recursive: true});
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {mode: 0o600});
	return configPath;
}

export async function loadConfig(): Promise<PolycodeConfig | null> {
	try {
		const rawConfig = await readFile(getConfigPath(), 'utf8');
		const config = JSON.parse(rawConfig) as PolycodeConfig;

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

export async function initializeConfig(options: InitOptions): Promise<{config: PolycodeConfig; configPath: string}> {
	const config = await createConfig(options);
	const configPath = await saveConfig(config);
	return {config, configPath};
}
