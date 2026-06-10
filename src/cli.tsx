import path from 'node:path';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {Command, Option} from 'commander';
import {render} from 'ink';
import chalk from 'chalk';
import boxen from 'boxen';
import {APP_NAME, COMMAND_NAME, MEMORY_BACKENDS, PROVIDERS, type InitOptions, type MemoryBackend, type Provider} from './domain.js';
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
	const instance = render(<Dashboard config={config} version={getVersion()} />);
	await instance.waitUntilExit();
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

	program.action(async () => {
		await runDashboard();
	});

	return program;
}

export async function main(argv = process.argv): Promise<void> {
	try {
		await buildProgram().parseAsync(argv);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(message));
		process.exitCode = 1;
	}
}

function isDirectExecution(): boolean {
	const entryPoint = process.argv[1];

	if (entryPoint === undefined) {
		return false;
	}

	return fileURLToPath(import.meta.url) === path.resolve(entryPoint);
}

if (isDirectExecution()) {
	await main();
}
