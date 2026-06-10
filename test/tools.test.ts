import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {getToolDefinitions} from '../src/tools/registry.js';
import type {ToolContext, ToolDefinition} from '../src/tools/types.js';

let temporaryDirectory = '';
let originalApproval: string | undefined;

function getTool(name: string): ToolDefinition {
	const tool = getToolDefinitions().find((definition) => definition.name === name);

	if (tool === undefined) {
		throw new Error(`Missing tool ${name}`);
	}

	return tool;
}

function context(approvalMode: ToolContext['approvalMode'] = 'allow'): ToolContext {
	return {
		workingDirectory: temporaryDirectory,
		approvalMode
	};
}

beforeEach(async () => {
	originalApproval = process.env.POLYCODE_TOOL_APPROVAL;
	temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'polycode-tools-'));
});

afterEach(async () => {
	if (originalApproval === undefined) {
		delete process.env.POLYCODE_TOOL_APPROVAL;
	} else {
		process.env.POLYCODE_TOOL_APPROVAL = originalApproval;
	}

	await rm(temporaryDirectory, {force: true, recursive: true});
});

describe('built-in tools', () => {
	it('reads files with line numbers and searches files', async () => {
		await writeFile(path.join(temporaryDirectory, 'hello.ts'), 'const hello = true;\n');

		const readResult = await getTool('read_file').execute({path: 'hello.ts'}, context());
		const searchResult = await getTool('search_files').execute({pattern: '*.ts', directory: '.'}, context());

		expect(readResult.message).toContain('1 | const hello = true;');
		expect(searchResult.message).toContain('hello.ts');
	});

	it('lists directories recursively', async () => {
		await writeFile(path.join(temporaryDirectory, 'package.json'), '{}');

		const result = await getTool('list_directory').execute({path: '.', recursive: true}, context());

		expect(result.message).toContain('package.json');
	});

	it('refuses file writes when approval is denied', async () => {
		const result = await getTool('write_file').execute({path: 'hello.txt', content: 'Hello World'}, context('deny'));

		expect(result.ok).toBe(false);
		expect(existsSync(path.join(temporaryDirectory, 'hello.txt'))).toBe(false);
	});

	it('writes files when approval is granted', async () => {
		const result = await getTool('write_file').execute({path: 'hello.txt', content: 'Hello World'}, context('allow'));

		expect(result.ok).toBe(true);
		await expect(readFile(path.join(temporaryDirectory, 'hello.txt'), 'utf8')).resolves.toBe('Hello World');
	});

	it('times out long-running commands gracefully', async () => {
		const result = await getTool('execute_command').execute({
			command: 'node -e "setTimeout(() => {}, 200)"',
			working_dir: '.',
			timeout_ms: 10
		}, context('allow'));

		expect(result.ok).toBe(false);
		expect(result.message).toContain('timed out');
	});

	it('uses mocked web search output for deterministic tests', async () => {
		process.env.POLYCODE_MOCK_WEB_SEARCH = 'Node.js LTS search result';

		try {
			const result = await getTool('web_search').execute({query: 'latest Node.js LTS', max_results: 3}, context());

			expect(result.message).toContain('Node.js LTS');
		} finally {
			delete process.env.POLYCODE_MOCK_WEB_SEARCH;
		}
	});
});
