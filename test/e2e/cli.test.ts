import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
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

	it('validates agents.yaml and chats with a mocked LLM', async () => {
		const home = path.join(temporaryRoot, 'home');
		const workspace = path.join(temporaryRoot, 'workspace');
		await runCli([
			'init',
			'--yes',
			'--project-name',
			'Demo',
			'--working-directory',
			workspace,
			'--provider',
			'openai',
			'--api-key',
			'test-key',
			'--memory',
			'chroma'
		], {
			POLYCODE_HOME: home
		});
		await writeFile(path.join(workspace, 'agents.yaml'), [
			'agents:',
			'  - name: researcher',
			'    role: Research specialist',
			'    goal: Find accurate information',
			'    memory_enabled: true',
			'    tools: [web_search, file_read]'
		].join('\n'));

		const validateResult = await runCli(['validate'], {
			POLYCODE_HOME: home
		});
		const chatResult = await runCli(['chat', 'researcher', '--message', 'remember Vitest'], {
			POLYCODE_HOME: home,
			POLYCODE_EMBEDDINGS: 'hash',
			POLYCODE_MEMORY_DRIVER: 'local',
			POLYCODE_MOCK_LLM_RESPONSE: 'Vitest remembered.'
		});
		const memoryResult = await runCli(['memory'], {
			POLYCODE_HOME: home,
			POLYCODE_EMBEDDINGS: 'hash',
			POLYCODE_MEMORY_DRIVER: 'local'
		});

		expect(validateResult.exitCode).toBe(0);
		expect(validateResult.stdout).toContain('Agents: 1');
		expect(chatResult.exitCode).toBe(0);
		expect(chatResult.stdout).toContain('Vitest remembered.');
		expect(memoryResult.exitCode).toBe(0);
		expect(memoryResult.stdout).toContain('Embeddings: 1');
	});

	it('fails invalid agents.yaml with readable validation output', async () => {
		const home = path.join(temporaryRoot, 'home');
		const workspace = path.join(temporaryRoot, 'workspace');
		await runCli([
			'init',
			'--yes',
			'--project-name',
			'Demo',
			'--working-directory',
			workspace,
			'--provider',
			'openai',
			'--api-key',
			'test-key',
			'--memory',
			'skip'
		], {
			POLYCODE_HOME: home
		});
		await writeFile(path.join(workspace, 'agents.yaml'), [
			'agents:',
			'  - name: bad agent',
			'    goal: Missing role'
		].join('\n'));

		const result = await runCli(['validate'], {
			POLYCODE_HOME: home
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('agents.0.role');
	});

	it('shows a friendly error when ChromaDB is unreachable', async () => {
		const home = path.join(temporaryRoot, 'home');
		const workspace = path.join(temporaryRoot, 'workspace');
		await runCli([
			'init',
			'--yes',
			'--project-name',
			'Demo',
			'--working-directory',
			workspace,
			'--provider',
			'openai',
			'--api-key',
			'test-key',
			'--memory',
			'chroma'
		], {
			POLYCODE_HOME: home
		});
		await writeFile(path.join(workspace, 'agents.yaml'), [
			'agents:',
			'  - name: researcher',
			'    role: Research specialist',
			'    goal: Find accurate information'
		].join('\n'));

		const result = await runCli(['chat', 'researcher', '--message', 'hello'], {
			CHROMA_PORT: '65530',
			POLYCODE_HOME: home,
			POLYCODE_EMBEDDINGS: 'hash',
			POLYCODE_MOCK_LLM_RESPONSE: 'hello'
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('ChromaDB is not reachable');
	});

	it('chats successfully when memory is skipped', async () => {
		const home = path.join(temporaryRoot, 'home');
		const workspace = path.join(temporaryRoot, 'workspace');
		await runCli([
			'init',
			'--yes',
			'--project-name',
			'Demo',
			'--working-directory',
			workspace,
			'--provider',
			'openai',
			'--api-key',
			'test-key',
			'--memory',
			'skip'
		], {
			POLYCODE_HOME: home
		});
		await writeFile(path.join(workspace, 'agents.yaml'), [
			'agents:',
			'  - name: researcher',
			'    role: Research specialist',
			'    goal: Find accurate information',
			'    memory_enabled: true'
		].join('\n'));

		const chatResult = await runCli(['chat', 'researcher', '--message', 'hello'], {
			POLYCODE_HOME: home,
			POLYCODE_MOCK_LLM_RESPONSE: 'skip memory works'
		});
		const memoryResult = await runCli(['memory'], {
			POLYCODE_HOME: home
		});

		expect(chatResult.exitCode).toBe(0);
		expect(chatResult.stdout).toContain('skip memory works');
		expect(memoryResult.exitCode).toBe(0);
		expect(memoryResult.stdout).toContain('Backend: skip');
		expect(memoryResult.stdout).toContain('Embeddings: 0');
	});

	it('runs a task against the first agent with mocked output', async () => {
		const home = path.join(temporaryRoot, 'home');
		const workspace = path.join(temporaryRoot, 'workspace');
		await runCli([
			'init',
			'--yes',
			'--project-name',
			'Demo',
			'--working-directory',
			workspace,
			'--provider',
			'openrouter',
			'--api-key',
			'test-key',
			'--memory',
			'skip'
		], {
			POLYCODE_HOME: home
		});
		await writeFile(path.join(workspace, 'agents.yaml'), [
			'agents:',
			'  - name: researcher',
			'    role: Research specialist',
			'    goal: Find accurate information',
			'    tools: [read_file, list_directory, search_files]'
		].join('\n'));

		const result = await runCli(['run', 'read package.json'], {
			POLYCODE_HOME: home,
			POLYCODE_MOCK_LLM_RESPONSE: 'package.json read'
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('package.json read');
	});
});
