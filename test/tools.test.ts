import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {getToolDefinitions} from '../src/tools/registry.js';
import type {ToolContext, ToolDefinition} from '../src/tools/types.js';

let temporaryDirectory = '';
let originalApproval: string | undefined;
let originalTavilyApiKey: string | undefined;
let originalWebSearchProvider: string | undefined;

function getTool(name: string): ToolDefinition {
	const tool = getToolDefinitions().find((definition) => definition.name === name);

	if (tool === undefined) {
		throw new Error(`Missing tool ${name}`);
	}

	return tool;
}

function context(approvalMode: ToolContext['approvalMode'] = 'allow', overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		workingDirectory: temporaryDirectory,
		approvalMode,
		...overrides
	};
}

beforeEach(async () => {
	originalApproval = process.env.POLYCODE_TOOL_APPROVAL;
	originalTavilyApiKey = process.env.TAVILY_API_KEY;
	originalWebSearchProvider = process.env.POLYCODE_WEB_SEARCH_PROVIDER;
	temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'polycode-tools-'));
});

afterEach(async () => {
	if (originalApproval === undefined) {
		delete process.env.POLYCODE_TOOL_APPROVAL;
	} else {
		process.env.POLYCODE_TOOL_APPROVAL = originalApproval;
	}

	if (originalTavilyApiKey === undefined) {
		delete process.env.TAVILY_API_KEY;
	} else {
		process.env.TAVILY_API_KEY = originalTavilyApiKey;
	}

	if (originalWebSearchProvider === undefined) {
		delete process.env.POLYCODE_WEB_SEARCH_PROVIDER;
	} else {
		process.env.POLYCODE_WEB_SEARCH_PROVIDER = originalWebSearchProvider;
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

	it('returns readable failures for missing and non-text files', async () => {
		await writeFile(path.join(temporaryDirectory, 'binary.bin'), Buffer.from([0, 1, 2, 3]));

		const missingResult = await getTool('read_file').execute({path: 'missing.txt'}, context());
		const binaryResult = await getTool('read_file').execute({path: 'binary.bin'}, context());

		expect(missingResult.ok).toBe(false);
		expect(missingResult.message).toContain('Could not read missing.txt');
		expect(binaryResult.ok).toBe(false);
		expect(binaryResult.message).toContain('non-text or binary');
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

	it('refuses append and command tools when approval is denied', async () => {
		await writeFile(path.join(temporaryDirectory, 'hello.txt'), 'Hello');

		const appendResult = await getTool('append_to_file').execute({path: 'hello.txt', content: ' World'}, context('deny'));
		const commandResult = await getTool('execute_command').execute({command: 'node -e "console.log(1)"', working_dir: '.', timeout_ms: 1000}, context('deny'));

		expect(appendResult.ok).toBe(false);
		expect(commandResult.ok).toBe(false);
		await expect(readFile(path.join(temporaryDirectory, 'hello.txt'), 'utf8')).resolves.toBe('Hello');
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

	it('uses DuckDuckGo no-key search with injected fetch', async () => {
		const result = await getTool('web_search').execute({query: 'polycode', max_results: 2}, context('allow', {
			webSearchProvider: 'duckduckgo',
			fetch: async () => new Response(JSON.stringify({
				AbstractText: 'Polycode summary',
				AbstractURL: 'https://example.com/polycode',
				RelatedTopics: [
					{Text: 'First related topic', FirstURL: 'https://example.com/1'}
				]
			}), {status: 200})
		}));

		expect(result.ok).toBe(true);
		expect(result.message).toContain('Polycode summary');
		expect(result.message).toContain('First related topic');
	});

	it('returns a readable failure when Tavily is selected without an API key', async () => {
		delete process.env.TAVILY_API_KEY;

		const result = await getTool('web_search').execute({query: 'latest Node.js LTS', max_results: 3}, context('allow', {
			webSearchProvider: 'tavily'
		}));

		expect(result.ok).toBe(false);
		expect(result.message).toContain('TAVILY_API_KEY');
	});

	it('returns readable failures for invalid URLs and network errors', async () => {
		const invalidUrlResult = await getTool('fetch_url').execute({url: 'not a url'} as any, context());
		const networkResult = await getTool('fetch_url').execute({url: 'https://example.com'}, context('allow', {
			fetch: async () => {
				throw new Error('network unavailable');
			}
		}));
		const searchNetworkResult = await getTool('web_search').execute({query: 'polycode', max_results: 1}, context('allow', {
			webSearchProvider: 'duckduckgo',
			fetch: async () => {
				throw new Error('offline');
			}
		}));

		expect(invalidUrlResult.ok).toBe(false);
		expect(invalidUrlResult.message).toContain('Invalid URL');
		expect(networkResult.ok).toBe(false);
		expect(networkResult.message).toContain('network unavailable');
		expect(searchNetworkResult.ok).toBe(false);
		expect(searchNetworkResult.message).toContain('offline');
	});
});
