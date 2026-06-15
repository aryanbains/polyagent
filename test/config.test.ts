import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {decryptSecret} from '../src/config/crypto.js';
import {getConfigPath, initializeConfig, loadConfig} from '../src/config/store.js';

let temporaryHome = '';
let originalPolyagentHome: string | undefined;

beforeEach(async () => {
	originalPolyagentHome = process.env.POLYAGENT_HOME;
	temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'polyagent-config-'));
	process.env.POLYAGENT_HOME = temporaryHome;
});

afterEach(async () => {
	if (originalPolyagentHome === undefined) {
		delete process.env.POLYAGENT_HOME;
	} else {
		process.env.POLYAGENT_HOME = originalPolyagentHome;
	}

	await rm(temporaryHome, {force: true, recursive: true});
});

describe('config store', () => {
	it('writes config outside the project and encrypts API keys', async () => {
		const secret = 'phase-one-secret';
		const {agentsFile, configPath} = await initializeConfig({
			projectName: 'Demo',
			workingDirectory: temporaryHome,
			provider: 'openai',
			apiKey: secret,
			memoryBackend: 'skip'
		});

		const rawConfig = await readFile(configPath, 'utf8');
		const loadedConfig = await loadConfig();

		expect(configPath).toBe(getConfigPath());
		expect(agentsFile.created).toBe(true);
		expect(agentsFile.filePath).toBe(path.join(temporaryHome, 'agents.yaml'));
		expect(rawConfig).not.toContain(secret);
		await expect(readFile(agentsFile.filePath, 'utf8')).resolves.toContain('name: researcher');
		expect(loadedConfig?.llm.provider).toBe('openai');
		expect(decryptSecret(loadedConfig?.llm.apiKey ?? null)).toBe(secret);
	});

	it('does not overwrite an existing agents.yaml during init', async () => {
		const workspace = path.join(temporaryHome, 'workspace');
		const agentsFilePath = path.join(workspace, 'agents.yaml');
		await mkdir(workspace, {recursive: true});
		await writeFile(agentsFilePath, 'agents:\n  - name: custom\n    role: Custom\n    goal: Keep me\n');

		const {agentsFile} = await initializeConfig({
			projectName: 'Demo',
			workingDirectory: workspace,
			provider: 'openai',
			apiKey: 'secret',
			memoryBackend: 'skip'
		});

		expect(agentsFile).toEqual({
			filePath: agentsFilePath,
			created: false
		});
		await expect(readFile(agentsFilePath, 'utf8')).resolves.toContain('name: custom');
	});

	it('shows a friendly error when an API key cannot be decrypted', async () => {
		const {configPath} = await initializeConfig({
			projectName: 'Demo',
			workingDirectory: temporaryHome,
			provider: 'openai',
			apiKey: 'phase-one-secret',
			memoryBackend: 'skip'
		});
		const config = JSON.parse(await readFile(configPath, 'utf8')) as {
			llm: {
				apiKey: {
					tag: string;
				};
			};
		};

		config.llm.apiKey.tag = Buffer.alloc(16).toString('base64');
		await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

		await expect(loadConfig()).rejects.toThrow('API key could not be decrypted. Run polyagent init to reconfigure.');
	});
});
