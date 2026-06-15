import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {getToolDefinitions} from '../src/tools/registry.js';
import type {ToolContext, ToolDefinition} from '../src/tools/types.js';

let workspace = '';

function getTool(name: string): ToolDefinition {
	const tool = getToolDefinitions().find((definition) => definition.name === name);

	if (tool === undefined) {
		throw new Error(`Missing tool ${name}`);
	}

	return tool;
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		workingDirectory: workspace,
		approvalMode: 'allow',
		...overrides
	};
}

beforeEach(async () => {
	workspace = await mkdtemp(path.join(os.tmpdir(), 'polyagent-phase35-'));
	await writeFile(path.join(workspace, 'package.json'), JSON.stringify({
		name: 'demo',
		dependencies: {
			ink: '^5.1.0'
		}
	}, null, 2));
	await writeFile(path.join(workspace, 'index.ts'), 'export const answer = 42;\n');
});

afterEach(async () => {
	await rm(workspace, {force: true, recursive: true});
});

describe('Phase 3.5 golden path regressions', () => {
	it('inspects a repo by listing and searching files', async () => {
		const directory = await getTool('list_directory').execute({path: '.', recursive: true}, context());
		const files = await getTool('search_files').execute({pattern: '*.ts', directory: '.'}, context());

		expect(directory.ok).toBe(true);
		expect(directory.message).toContain('package.json');
		expect(files.ok).toBe(true);
		expect(files.message).toContain('index.ts');
	});

	it('summarizes file inputs by reading line-numbered content', async () => {
		const result = await getTool('read_file').execute({path: 'package.json'}, context());

		expect(result.ok).toBe(true);
		expect(result.message).toContain('1 | {');
		expect(result.message).toContain('"ink"');
	});

	it('modifies a file through the guarded write path', async () => {
		const result = await getTool('write_file').execute({path: 'notes.txt', content: 'Hello Phase 3.5'}, context());

		expect(result.ok).toBe(true);
		await expect(readFile(path.join(workspace, 'notes.txt'), 'utf8')).resolves.toBe('Hello Phase 3.5');
	});

	it('runs a command with captured output', async () => {
		const result = await getTool('execute_command').execute({
			command: 'node --version',
			working_dir: '.',
			timeout_ms: 5000
		}, context());

		expect(result.ok).toBe(true);
		expect(result.message.trim()).toMatch(/^v\d+\./);
	});

	it('fetches docs from the web using no-key search and URL fetch', async () => {
		const search = await getTool('web_search').execute({query: 'Polyagent docs', max_results: 2}, context({
			webSearchProvider: 'duckduckgo',
			fetch: async () => new Response(JSON.stringify({
				AbstractText: 'Polyagent documentation',
				AbstractURL: 'https://example.com/docs'
			}), {status: 200})
		}));
		const page = await getTool('fetch_url').execute({url: 'https://example.com/docs'}, context({
			fetch: async () => new Response('<html><body><h1>Docs</h1><p>Install with npm.</p></body></html>', {
				status: 200,
				headers: {
					'content-type': 'text/html'
				}
			})
		}));

		expect(search.ok).toBe(true);
		expect(search.message).toContain('Polyagent documentation');
		expect(page.ok).toBe(true);
		expect(page.message).toContain('Install with npm.');
	});
});
