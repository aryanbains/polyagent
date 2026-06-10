import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {execaCommand} from 'execa';
import fg from 'fast-glob';
import {tavily} from '@tavily/core';
import {z} from 'zod';
import {createUnifiedDiff, limitOutput, readTextFileIfExists, requestApproval, resolveWorkspacePath, writeTextFile} from './safety.js';
import type {ToolContext, ToolDefinition, ToolResult, WebSearchProvider} from './types.js';

function withLineNumbers(content: string): string {
	const lines = content.split(/\r?\n/);
	const width = String(lines.length).length;
	return lines.map((line, index) => `${String(index + 1).padStart(width, ' ')} | ${line}`).join('\n');
}

function isLikelyText(buffer: Buffer): boolean {
	if (buffer.length === 0) {
		return true;
	}

	if (buffer.includes(0)) {
		return false;
	}

	const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
	const text = sample.toString('utf8');
	const replacementCharacters = [...text].filter((character) => character === '\uFFFD').length;
	return replacementCharacters / Math.max(text.length, 1) < 0.05;
}

async function directoryTree(directory: string, recursive: boolean): Promise<string> {
	if (recursive) {
		const entries = await fg(['**/*'], {
			cwd: directory,
			dot: true,
			onlyFiles: false,
			unique: true
		});
		return entries.sort().join('\n') || '.';
	}

	const entries = await readdir(directory, {withFileTypes: true});
	return entries
		.map((entry) => `${entry.isDirectory() ? '[dir] ' : '      '}${entry.name}`)
		.sort()
		.join('\n') || '.';
}

function stripHtml(value: string): string {
	return value
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function getFetch(context?: ToolContext): typeof fetch {
	return context?.fetch ?? fetch;
}

function resolveWebSearchProvider(context: ToolContext): WebSearchProvider {
	const value = process.env.POLYCODE_WEB_SEARCH_PROVIDER?.toLowerCase();

	if (value === 'tavily' || value === 'duckduckgo' || value === 'auto') {
		return value;
	}

	return context.webSearchProvider ?? 'auto';
}

type DuckDuckGoTopic = {
	Text?: string;
	FirstURL?: string;
	Topics?: DuckDuckGoTopic[];
};

function flattenDuckDuckGoTopics(topics: DuckDuckGoTopic[]): DuckDuckGoTopic[] {
	return topics.flatMap((topic) => topic.Topics === undefined ? [topic] : flattenDuckDuckGoTopics(topic.Topics));
}

async function duckDuckGoSearch(query: string, maxResults: number, context: ToolContext): Promise<ToolResult> {
	const url = new URL('https://api.duckduckgo.com/');
	url.searchParams.set('q', query);
	url.searchParams.set('format', 'json');
	url.searchParams.set('no_html', '1');
	url.searchParams.set('no_redirect', '1');
	url.searchParams.set('skip_disambig', '1');
	let response: Response;

	try {
		response = await getFetch(context)(url);
	} catch (error) {
		return {
			ok: false,
			message: `DuckDuckGo search failed: ${error instanceof Error ? error.message : String(error)}`
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			message: `DuckDuckGo search failed with HTTP ${response.status}`
		};
	}

	const data = await response.json() as {
		Answer?: string;
		AbstractText?: string;
		AbstractURL?: string;
		Definition?: string;
		DefinitionURL?: string;
		RelatedTopics?: DuckDuckGoTopic[];
	};
	const related = flattenDuckDuckGoTopics(data.RelatedTopics ?? [])
		.filter((item) => item.Text !== undefined)
		.slice(0, maxResults)
		.map((item, index) => `${index + 1}. ${item.Text}${item.FirstURL === undefined ? '' : ` (${item.FirstURL})`}`);
	const message = [
		data.Answer,
		data.AbstractText === undefined || data.AbstractText.length === 0 ? undefined : `${data.AbstractText}${data.AbstractURL === undefined ? '' : ` (${data.AbstractURL})`}`,
		data.Definition === undefined || data.Definition.length === 0 ? undefined : `${data.Definition}${data.DefinitionURL === undefined ? '' : ` (${data.DefinitionURL})`}`,
		...related
	].filter(Boolean).join('\n');

	return {
		ok: true,
		message: message || 'No DuckDuckGo instant answers returned.',
		data
	};
}

async function tavilySearch(query: string, maxResults: number): Promise<ToolResult> {
	if (process.env.TAVILY_API_KEY === undefined || process.env.TAVILY_API_KEY.length === 0) {
		return {
			ok: false,
			message: 'Tavily web search requires TAVILY_API_KEY. Use /settings web duckduckgo for no-key search.'
		};
	}

	const client = tavily({apiKey: process.env.TAVILY_API_KEY});
	let result: Awaited<ReturnType<typeof client.search>>;

	try {
		result = await client.search(query, {
			maxResults,
			includeAnswer: true,
			searchDepth: 'basic'
		});
	} catch (error) {
		return {
			ok: false,
			message: `Tavily search failed: ${error instanceof Error ? error.message : String(error)}`
		};
	}
	const results = result.results.map((item, index) => `${index + 1}. ${item.title}\n${item.url}\n${item.content}`).join('\n\n');
	return {
		ok: true,
		message: [result.answer, results].filter(Boolean).join('\n\n')
	};
}

export function getBuiltInToolDefinitions(): ToolDefinition[] {
	return [
		{
			name: 'read_file',
			description: 'Read a text file from the workspace and return contents with line numbers.',
			inputSchema: z.object({
				path: z.string().describe('Workspace-relative file path')
			}),
			async execute(input, context) {
				const filePath = resolveWorkspacePath(context.workingDirectory, input.path);
				let buffer: Buffer;

				try {
					buffer = await readFile(filePath);
				} catch (error) {
					return {
						ok: false,
						message: `Could not read ${input.path}: ${error instanceof Error ? error.message : String(error)}`
					};
				}

				if (!isLikelyText(buffer)) {
					return {
						ok: false,
						message: `${input.path} appears to be a non-text or binary file.`
					};
				}

				const content = buffer.toString('utf8');
				return {
					ok: true,
					message: withLineNumbers(content)
				};
			}
		},
		{
			name: 'write_file',
			description: 'Write a text file in the workspace after showing a unified diff and receiving approval.',
			inputSchema: z.object({
				path: z.string().describe('Workspace-relative file path'),
				content: z.string().describe('Full new file contents')
			}),
			async execute(input, context) {
				const filePath = resolveWorkspacePath(context.workingDirectory, input.path);
				const before = await readTextFileIfExists(filePath);
				const diff = createUnifiedDiff(input.path, before, input.content);
				const approved = await requestApproval(`Apply write_file to ${input.path}?`, context, diff);

				if (!approved) {
					return {ok: false, message: `write_file declined for ${input.path}`};
				}

				await writeTextFile(filePath, input.content);
				return {ok: true, message: `Wrote ${input.path}`};
			}
		},
		{
			name: 'append_to_file',
			description: 'Append text to a workspace file after showing a diff and receiving approval.',
			inputSchema: z.object({
				path: z.string().describe('Workspace-relative file path'),
				content: z.string().describe('Text to append')
			}),
			async execute(input, context) {
				const filePath = resolveWorkspacePath(context.workingDirectory, input.path);
				const before = await readTextFileIfExists(filePath);
				const after = `${before}${before.length > 0 && !before.endsWith('\n') ? '\n' : ''}${input.content}`;
				const diff = createUnifiedDiff(input.path, before, after);
				const approved = await requestApproval(`Apply append_to_file to ${input.path}?`, context, diff);

				if (!approved) {
					return {ok: false, message: `append_to_file declined for ${input.path}`};
				}

				await writeTextFile(filePath, after);
				return {ok: true, message: `Appended to ${input.path}`};
			}
		},
		{
			name: 'list_directory',
			description: 'List files and folders in a workspace directory.',
			inputSchema: z.object({
				path: z.string().default('.').describe('Workspace-relative directory path'),
				recursive: z.boolean().default(false).describe('Whether to list recursively')
			}),
			async execute(input, context) {
				const directory = resolveWorkspacePath(context.workingDirectory, input.path);
				return {
					ok: true,
					message: await directoryTree(directory, input.recursive)
				};
			}
		},
		{
			name: 'search_files',
			description: 'Search for files in the workspace using a glob pattern.',
			inputSchema: z.object({
				pattern: z.string().describe('Glob pattern, for example src/**/*.ts'),
				directory: z.string().default('.').describe('Workspace-relative directory to search in')
			}),
			async execute(input, context) {
				const directory = resolveWorkspacePath(context.workingDirectory, input.directory);
				const matches = await fg(input.pattern, {
					cwd: directory,
					dot: true,
					onlyFiles: true,
					unique: true
				});
				return {
					ok: true,
					message: matches.sort().join('\n') || 'No matching files found.'
				};
			}
		},
		{
			name: 'execute_command',
			description: 'Execute a shell command in the workspace after approval. Times out by default after 10 seconds.',
			inputSchema: z.object({
				command: z.string().describe('Command to execute'),
				working_dir: z.string().default('.').describe('Workspace-relative working directory'),
				timeout_ms: z.number().int().positive().max(120_000).default(10_000)
			}),
			async execute(input, context) {
				const cwd = resolveWorkspacePath(context.workingDirectory, input.working_dir);
				const approved = await requestApproval(`Execute command in ${input.working_dir}: ${input.command}?`, context, input.command);

				if (!approved) {
					return {ok: false, message: `execute_command declined: ${input.command}`};
				}

				const result = await execaCommand(input.command, {
					cwd,
					timeout: input.timeout_ms,
					reject: false,
					all: true
				});

				if (result.timedOut) {
					return {ok: false, message: `Command timed out after ${input.timeout_ms}ms.`};
				}

				return {
					ok: result.exitCode === 0,
					message: limitOutput(result.all ?? result.stdout ?? result.stderr ?? '')
				};
			}
		},
		{
			name: 'web_search',
			description: 'Search the web using Tavily when TAVILY_API_KEY is configured, otherwise a limited DuckDuckGo fallback.',
			inputSchema: z.object({
				query: z.string().describe('Search query'),
				max_results: z.number().int().positive().max(10).default(5)
			}),
			async execute(input, context) {
				if (process.env.POLYCODE_MOCK_WEB_SEARCH !== undefined) {
					return {ok: true, message: process.env.POLYCODE_MOCK_WEB_SEARCH};
				}

				const provider = resolveWebSearchProvider(context);

				if (provider === 'tavily') {
					return tavilySearch(input.query, input.max_results);
				}

				if (provider === 'duckduckgo') {
					return duckDuckGoSearch(input.query, input.max_results, context);
				}

				return process.env.TAVILY_API_KEY === undefined || process.env.TAVILY_API_KEY.length === 0
					? duckDuckGoSearch(input.query, input.max_results, context)
					: tavilySearch(input.query, input.max_results);
			}
		},
		{
			name: 'fetch_url',
			description: 'Fetch a URL and return readable text content.',
			inputSchema: z.object({
				url: z.string().url().describe('URL to fetch')
			}),
			async execute(input, context) {
				let url: URL;

				try {
					url = new URL(input.url);
				} catch {
					return {ok: false, message: `Invalid URL: ${input.url}`};
				}

				let response: Response;

				try {
					response = await getFetch(context)(url, {
						headers: {
							'User-Agent': 'Polycode/0.1'
						}
					});
				} catch (error) {
					return {
						ok: false,
						message: `Could not fetch ${input.url}: ${error instanceof Error ? error.message : String(error)}`
					};
				}

				if (!response.ok) {
					return {ok: false, message: `Fetch failed with HTTP ${response.status}`};
				}

				const contentType = response.headers.get('content-type') ?? '';
				const body = await response.text();
				return {
					ok: true,
					message: limitOutput(contentType.includes('html') ? stripHtml(body) : body)
				};
			}
		}
	];
}
