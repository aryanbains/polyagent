import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {decryptSecret} from '../src/config/crypto.js';
import {getConfigPath, initializeConfig, loadConfig} from '../src/config/store.js';

let temporaryHome = '';
let originalPolycodeHome: string | undefined;

beforeEach(async () => {
	originalPolycodeHome = process.env.POLYCODE_HOME;
	temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'polycode-config-'));
	process.env.POLYCODE_HOME = temporaryHome;
});

afterEach(async () => {
	if (originalPolycodeHome === undefined) {
		delete process.env.POLYCODE_HOME;
	} else {
		process.env.POLYCODE_HOME = originalPolycodeHome;
	}

	await rm(temporaryHome, {force: true, recursive: true});
});

describe('config store', () => {
	it('writes config outside the project and encrypts API keys', async () => {
		const secret = 'phase-one-secret';
		const {configPath} = await initializeConfig({
			projectName: 'Demo',
			workingDirectory: temporaryHome,
			provider: 'openai',
			apiKey: secret,
			memoryBackend: 'skip'
		});

		const rawConfig = await readFile(configPath, 'utf8');
		const loadedConfig = await loadConfig();

		expect(configPath).toBe(getConfigPath());
		expect(rawConfig).not.toContain(secret);
		expect(loadedConfig?.llm.provider).toBe('openai');
		expect(decryptSecret(loadedConfig?.llm.apiKey ?? null)).toBe(secret);
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

		await expect(loadConfig()).rejects.toThrow('API key could not be decrypted. Run polycode init to reconfigure.');
	});
});
