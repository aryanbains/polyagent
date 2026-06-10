import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {ModelMessage} from 'ai';
import React from 'react';
import {Command, Option} from 'commander';
import {render} from 'ink';
import chalk from 'chalk';
import boxen from 'boxen';
import {findAgent, loadAgents} from './agents/load.js';
import {AgentConfigError} from './agents/schema.js';
import {runAgentTurn} from './chat/run.js';
import {APP_NAME, COMMAND_NAME, MEMORY_BACKENDS, PROVIDERS, type InitOptions, type MemoryBackend, type Provider} from './domain.js';
import {createMemoryStore, getMemoryStats} from './memory/factory.js';
import {ChromaUnavailableError} from './memory/chroma-store.js';
import {Dashboard} from './ui/Dashboard.js';
import {InitWizard} from './ui/InitWizard.js';
import {getConfigPath, initializeConfig, loadConfig} from './config/store.js';
import {getVersion} from './version.js';

function isProvider(value: string): value is Provider {
	return PROVIDERS.includes(value as Provider);
}

function isMemoryBackend(value: string): value is MemoryBackend {
	return MEMORY_BACKENDS.includes(value as MemoryBackend);
}

function requireProvider(value: string): Provider {
	if (!isProvider(value)) {
		throw new Error(`Unsupported provider "${value}". Choose one of: ${PROVIDERS.join(', ')}.`);
	}

	return value;
}

function requireMemoryBackend(value: string): MemoryBackend {
	if (!isMemoryBackend(value)) {
		throw new Error(`Unsupported memory backend "${value}". Choose one of: ${MEMORY_BACKENDS.join(', ')}.`);
	}

	return value;
}

type InitCommandOptions = {
	yes?: boolean;
	projectName?: string;
	workingDirectory?: string;
	provider?: string;
	apiKey?: string;
	memory?: string;
};

type ValidateCommandOptions = {
	file?: string;
};

type ChatCommandOptions = {
	message?: string;
};

type MemoryCommandOptions = {
	agent?: string;
	clear?: boolean;
};

async function runInit(options: InitCommandOptions): Promise<void> {
	if (options.yes) {
		const provider = requireProvider(options.provider ?? 'openai');
		const memoryBackend = requireMemoryBackend(options.memory ?? 'skip');
		const initOptions: InitOptions = {
			projectName: options.projectName ?? APP_NAME,
			workingDirectory: options.workingDirectory ?? process.cwd(),
			provider,
			apiKey: options.apiKey ?? '',
			memoryBackend
		};
		const {config, configPath} = await initializeConfig(initOptions);

		console.log(chalk.green(`${APP_NAME} configured.`));
		console.log(`Project: ${config.project.name}`);
		console.log(`Working directory: ${config.project.workingDirectory}`);
		console.log(`Provider: ${config.llm.provider}`);
		console.log(`Memory: ${config.memory.backend}`);
		console.log(`Config: ${configPath}`);
		return;
	}

	const instance = render(<InitWizard />);
	await instance.waitUntilExit();
}

async function runDashboard(): Promise<void> {
	const config = await loadConfig();
	const workingDirectory = config?.project.workingDirectory ?? process.cwd();
	let agentsError: string | null = null;
	const agents = await loadAgents({workingDirectory}).then((result) => result.agents).catch((error: unknown) => {
		agentsError = error instanceof Error ? error.message : String(error);
		return [];
	});
	const memoryStats = await getMemoryStats(config);
	const instance = render(<Dashboard agents={agents} agentsError={agentsError} config={config} memoryStats={memoryStats} version={getVersion()} />);
	await instance.waitUntilExit();
}

async function runValidate(options: ValidateCommandOptions): Promise<void> {
	const config = await loadConfig();
	const workingDirectory = config?.project.workingDirectory ?? process.cwd();
	const result = await loadAgents({workingDirectory, filePath: options.file, requireFile: true});

	console.log(chalk.green(`${APP_NAME} agent config is valid.`));
	console.log(`File: ${result.filePath}`);
	console.log(`Agents: ${result.agents.length}`);

	for (const agent of result.agents) {
		console.log(`- ${agent.name}: ${agent.role}`);
	}
}

async function runChat(agentName: string, options: ChatCommandOptions): Promise<void> {
	const config = await loadConfig();

	if (config === null) {
		throw new Error(`${APP_NAME} is not configured yet. Run ${COMMAND_NAME} init first.`);
	}

	const {agents} = await loadAgents({workingDirectory: config.project.workingDirectory, requireFile: true});
	const agent = findAgent(agents, agentName);
	const conversation: ModelMessage[] = [];

	if (options.message !== undefined) {
		await runAgentTurn({
			config,
			agent,
			message: options.message,
			conversation,
			onToken: (token) => {
				process.stdout.write(token);
			}
		});
		process.stdout.write('\n');
		return;
	}

	const input = createInterface({
		input: process.stdin,
		output: process.stdout
	});

	try {
		console.log(chalk.cyan(`Chatting with ${agent.name}. Type .exit to quit.`));

		while (true) {
			const message = await input.question('you> ');

			if (message.trim() === '.exit') {
				break;
			}

			if (message.trim().length === 0) {
				continue;
			}

			process.stdout.write(`${agent.name}> `);
			await runAgentTurn({
				config,
				agent,
				message,
				conversation,
				onToken: (token) => {
					process.stdout.write(token);
				}
			});
			process.stdout.write('\n');
		}
	} finally {
		input.close();
	}
}

async function runMemory(options: MemoryCommandOptions): Promise<void> {
	const config = await loadConfig();

	if (config === null) {
		throw new Error(`${APP_NAME} is not configured yet. Run ${COMMAND_NAME} init first.`);
	}

	const memoryStore = createMemoryStore(config);

	if (options.clear) {
		await memoryStore.clear(options.agent);
		console.log(chalk.green(options.agent === undefined ? 'Memory cleared.' : `Memory cleared for ${options.agent}.`));
		return;
	}

	const stats = await memoryStore.stats(options.agent);
	console.log(boxen([
		chalk.bold(`${APP_NAME} memory`),
		`Backend: ${stats.backend}`,
		`Embeddings: ${stats.totalEmbeddings}`,
		`Last access: ${stats.lastAccessedAt ?? 'never'}`,
		stats.storagePath === undefined ? undefined : `Storage: ${stats.storagePath}`,
		stats.status === undefined ? undefined : `Status: ${stats.status}`
	].filter((line): line is string => line !== undefined).join('\n'), {
		padding: 1,
		borderColor: 'cyan',
		borderStyle: 'round'
	}));
}

async function runStatus(): Promise<void> {
	const config = await loadConfig();

	if (config === null) {
		console.log(boxen(`${APP_NAME} is not configured yet.\nRun ${chalk.cyan(`${COMMAND_NAME} init`)} to start.`, {
			padding: 1,
			borderColor: 'yellow',
			borderStyle: 'round'
		}));
		return;
	}

	console.log(boxen([
		chalk.bold(`${APP_NAME} status`),
		`Project: ${config.project.name}`,
		`Working directory: ${config.project.workingDirectory}`,
		`Provider: ${config.llm.provider}`,
		`Memory: ${config.memory.backend}`,
		`Config: ${getConfigPath()}`
	].join('\n'), {
		padding: 1,
		borderColor: 'cyan',
		borderStyle: 'round'
	}));
}

export function buildProgram(): Command {
	const program = new Command();

	program
		.name(COMMAND_NAME)
		.description(`${APP_NAME}: JavaScript-native multi-agent orchestration in your terminal.`)
		.version(getVersion());

	program
		.command('init')
		.description(`Configure ${APP_NAME} for this machine.`)
		.option('-y, --yes', 'Run onboarding non-interactively with provided options.')
		.option('--project-name <name>', 'Project name for the dashboard.')
		.option('--working-directory <path>', 'Project working directory.')
		.addOption(new Option('--provider <provider>', 'LLM provider.').choices([...PROVIDERS]))
		.option('--api-key <key>', 'API key for the selected provider. The value is never echoed back.')
		.addOption(new Option('--memory <backend>', 'Memory backend preference.').choices([...MEMORY_BACKENDS]))
		.action(async (options: InitCommandOptions) => {
			await runInit(options);
		});

	program
		.command('status')
		.description(`Show the current ${APP_NAME} configuration summary.`)
		.action(async () => {
			await runStatus();
		});

	program
		.command('validate')
		.description('Validate agents.yaml, agents.yml, or agents.json in the configured workspace.')
		.option('--file <path>', 'Validate a specific agents file.')
		.action(async (options: ValidateCommandOptions) => {
			await runValidate(options);
		});

	program
		.command('chat')
		.description('Chat with a configured agent.')
		.argument('<agent-name>', 'Agent name from agents.yaml.')
		.option('-m, --message <message>', 'Send one message and print the streamed response.')
		.action(async (agentName: string, options: ChatCommandOptions) => {
			await runChat(agentName, options);
		});

	program
		.command('memory')
		.description('Inspect or clear agent memory.')
		.option('--agent <name>', 'Limit memory operation to one agent.')
		.option('--clear', 'Clear memory instead of showing status.')
		.action(async (options: MemoryCommandOptions) => {
			await runMemory(options);
		});

	program.action(async () => {
		await runDashboard();
	});

	return program;
}

export async function main(argv = process.argv): Promise<void> {
	try {
		await buildProgram().parseAsync(argv);
	} catch (error) {
		const message = error instanceof AgentConfigError || error instanceof ChromaUnavailableError || error instanceof Error ? error.message : String(error);
		console.error(chalk.red(message));
		process.exitCode = 1;
	}
}

export function isDirectExecution(entryPoint = process.argv[1], moduleUrl = import.meta.url): boolean {
	if (entryPoint === undefined) {
		return false;
	}

	try {
		return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(path.resolve(entryPoint));
	} catch {
		return fileURLToPath(moduleUrl) === path.resolve(entryPoint);
	}
}

if (isDirectExecution()) {
	await main();
}
