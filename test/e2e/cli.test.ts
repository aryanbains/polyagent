import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

let temporaryRoot = '';

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{stdout: string; stderr: string; exitCode: number | null}> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [path.resolve('dist/cli.js'), ...args], {
			env: {
				...process.env,
				...env
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});
		child.on('close', (exitCode) => {
			resolve({stdout, stderr, exitCode});
		});
	});
}

beforeEach(async () => {
	temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'polycode-e2e-'));
});

afterEach(async () => {
	await rm(temporaryRoot, {force: true, recursive: true});
});

describe('polycode cli', () => {
	it('prints the package version', async () => {
		const result = await runCli(['--version']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});

	it('runs non-interactive init without echoing the API key', async () => {
		const secret = 'super-secret-e2e-key';
		const home = path.join(temporaryRoot, 'home');
		const workspace = path.join(temporaryRoot, 'workspace');
		const result = await runCli([
			'init',
			'--yes',
			'--project-name',
			'Demo',
			'--working-directory',
			workspace,
			'--provider',
			'openai',
			'--api-key',
			secret,
			'--memory',
			'skip'
		], {
			POLYCODE_HOME: home
		});

		const rawConfig = await readFile(path.join(home, 'config.json'), 'utf8');

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Polycode configured.');
		expect(result.stdout).not.toContain(secret);
		expect(result.stderr).not.toContain(secret);
		expect(rawConfig).not.toContain(secret);
		expect(rawConfig).toContain('"provider": "openai"');
	});
});
