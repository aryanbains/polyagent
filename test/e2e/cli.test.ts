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
	temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'polyagent-e2e-'));
});

afterEach(async () => {
	await rm(temporaryRoot, {force: true, recursive: true});
});

describe('polyagent cli', () => {
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
			POLYAGENT_HOME: home
		});

		const rawConfig = await readFile(path.join(home, 'config.json'), 'utf8');
		const starterAgents = await readFile(path.join(workspace, 'agents.yaml'), 'utf8');
		const validateResult = await runCli(['validate'], {
			POLYAGENT_HOME: home
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Polyagent configured.');
		expect(result.stdout).toContain('Agents: Created');
		expect(result.stdout).toContain('polyagent validate');
		expect(result.stdout).not.toContain(secret);
		expect(result.stderr).not.toContain(secret);
		expect(rawConfig).not.toContain(secret);
		expect(rawConfig).toContain('"provider": "openai"');
		expect(starterAgents).toContain('name: researcher');
		expect(validateResult.exitCode).toBe(0);
		expect(validateResult.stdout).toContain('Agents: 3');
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
			POLYAGENT_HOME: home
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
			POLYAGENT_HOME: home
		});
		const chatResult = await runCli(['chat', 'researcher', '--message', 'remember Vitest'], {
			POLYAGENT_HOME: home,
			POLYAGENT_EMBEDDINGS: 'hash',
			POLYAGENT_MEMORY_DRIVER: 'local',
			POLYAGENT_MOCK_LLM_RESPONSE: 'Vitest remembered.'
		});
		const memoryResult = await runCli(['memory'], {
			POLYAGENT_HOME: home,
			POLYAGENT_EMBEDDINGS: 'hash',
			POLYAGENT_MEMORY_DRIVER: 'local'
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
			POLYAGENT_HOME: home
		});
		await writeFile(path.join(workspace, 'agents.yaml'), [
			'agents:',
			'  - name: bad agent',
			'    goal: Missing role'
		].join('\n'));

		const result = await runCli(['validate'], {
			POLYAGENT_HOME: home
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
			POLYAGENT_HOME: home
		});
		await writeFile(path.join(workspace, 'agents.yaml'), [
			'agents:',
			'  - name: researcher',
			'    role: Research specialist',
			'    goal: Find accurate information'
		].join('\n'));

		const result = await runCli(['chat', 'researcher', '--message', 'hello'], {
			CHROMA_PORT: '65530',
			POLYAGENT_HOME: home,
			POLYAGENT_EMBEDDINGS: 'hash',
			POLYAGENT_MOCK_LLM_RESPONSE: 'hello'
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
			POLYAGENT_HOME: home
		});
		await writeFile(path.join(workspace, 'agents.yaml'), [
			'agents:',
			'  - name: researcher',
			'    role: Research specialist',
			'    goal: Find accurate information',
			'    memory_enabled: true'
		].join('\n'));

		const chatResult = await runCli(['chat', 'researcher', '--message', 'hello'], {
			POLYAGENT_HOME: home,
			POLYAGENT_MOCK_LLM_RESPONSE: 'skip memory works'
		});
		const memoryResult = await runCli(['memory'], {
			POLYAGENT_HOME: home
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
			POLYAGENT_HOME: home
		});
		await writeFile(path.join(workspace, 'agents.yaml'), [
			'agents:',
			'  - name: researcher',
			'    role: Research specialist',
			'    goal: Find accurate information',
			'    tools: [read_file, list_directory, search_files]'
		].join('\n'));

		const result = await runCli(['run', 'read package.json'], {
			POLYAGENT_HOME: home,
			POLYAGENT_MOCK_LLM_RESPONSE: 'package.json read'
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('package.json read');
	});

	it('runs a multi-agent task, records a session, and replays it', async () => {
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
			POLYAGENT_HOME: home
		});

		const runResult = await runCli([
			'run',
			'--multi',
			'--yes',
			'Research the top 5 JavaScript testing frameworks in 2024, compare their features, and create a markdown report at ./reports/testing-frameworks.md'
		], {
			POLYAGENT_HOME: home,
			POLYAGENT_MOCK_LLM_RESPONSE: 'multi agent output'
		});
		const report = await readFile(path.join(workspace, 'reports', 'testing-frameworks.md'), 'utf8');
		const sessionMatch = /Session: (.+\.json)/.exec(runResult.stdout);
		const replayResult = await runCli(['replay', sessionMatch?.[1] ?? '', '--speed', '10'], {
			POLYAGENT_HOME: home
		});

		expect(runResult.exitCode).toBe(0);
		expect(runResult.stdout).toContain('Plan');
		expect(runResult.stdout).toContain('starting research with researcher');
		expect(runResult.stdout).toContain('Session:');
		expect(report).toContain('JavaScript testing frameworks');
		expect(replayResult.exitCode).toBe(0);
		expect(replayResult.stdout).toContain('Polyagent replay');
		expect(replayResult.stdout).toContain('Replay complete: success');
	});
});
