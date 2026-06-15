import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {ModelMessage} from 'ai';
import React from 'react';
import {Command, Option} from 'commander';
import {render} from 'ink';
import {confirm} from '@inquirer/prompts';
import chalk from 'chalk';
import boxen from 'boxen';
import {findAgent, loadAgents} from './agents/load.js';
import {AgentConfigError} from './agents/schema.js';
import {AiSdkLlmClient, runAgentTurn} from './chat/run.js';
import {APP_NAME, COMMAND_NAME, MEMORY_BACKENDS, PROVIDERS, type InitOptions, type MemoryBackend, type Provider} from './domain.js';
import {createMemoryStore, getMemoryStats} from './memory/factory.js';
import {ChromaUnavailableError} from './memory/chroma-store.js';
import {summarizeToolOutput} from './tools/registry.js';
import type {ToolApprovalMode} from './tools/types.js';
import {runMultiAgentTask} from './orchestration/run.js';
import {loadRecordedSession} from './orchestration/session-recorder.js';
import {planMultiAgentTaskDynamically, type MultiAgentPlan} from './orchestration/planner.js';
import {Dashboard} from './ui/Dashboard.js';
import {InitWizard} from './ui/InitWizard.js';
import {MultiAgentSessionView} from './ui/MultiAgentSessionView.js';
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
	yes?: boolean;
};

type MemoryCommandOptions = {
	agent?: string;
	clear?: boolean;
};

type RunCommandOptions = {
	agent?: string;
	multi?: boolean;
	yes?: boolean;
};

type ReplayCommandOptions = {
	speed?: string;
};

function printNextSteps(agentName = 'researcher'): void {
	console.log('');
	console.log(chalk.bold('Next steps'));
	console.log(`1. ${chalk.cyan(`${COMMAND_NAME} validate`)} - check your agents.yaml`);
	console.log(`2. ${chalk.cyan(COMMAND_NAME)} - open the dashboard`);
	console.log(`3. ${chalk.cyan(`${COMMAND_NAME} chat ${agentName}`)} - start an interactive agent session`);
	console.log(`4. ${chalk.cyan(`${COMMAND_NAME} run "read package.json and summarize this project"`)} - run a one-shot task`);
}

function getApprovalMode(yes?: boolean): ToolApprovalMode {
	if (yes === true) {
		return 'allow';
	}

	return 'prompt';
}

function printToolStart(toolName: string, input: unknown): void {
	console.log(chalk.cyan(`-> ${toolName}(${JSON.stringify(input)})`));
}

function printToolFinish(toolName: string, output: unknown, success: boolean): void {
	const color = success ? chalk.green : chalk.red;
	console.log(color(`<-${success ? '' : ' failed'} ${toolName}: ${summarizeToolOutput(output)}`));
}

function printPlan(plan: MultiAgentPlan): void {
	console.log(chalk.bold(`Plan ${plan.id} (${plan.source})`));

	for (const step of plan.steps) {
		const dependencyText = step.dependsOn.length === 0 ? 'none' : step.dependsOn.join(', ');
		console.log(`- ${step.id}: ${step.title}`);
		console.log(`  agent: ${step.agentName}`);
		console.log(`  depends on: ${dependencyText}`);
	}
}

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
		const {config, configPath, agentsFile} = await initializeConfig(initOptions);

		console.log(chalk.green(`${APP_NAME} configured.`));
		console.log(`Project: ${config.project.name}`);
		console.log(`Working directory: ${config.project.workingDirectory}`);
		console.log(`Provider: ${config.llm.provider}`);
		console.log(`Memory: ${config.memory.backend}`);
		console.log(`Agents: ${agentsFile.created ? 'Created' : 'Using existing'} ${agentsFile.filePath}`);
		console.log(`Config: ${configPath}`);
		printNextSteps();
		return;
	}

	const instance = render(<InitWizard />);
	await instance.waitUntilExit();
}

async function runDashboard(): Promise<void> {
	const config = await loadConfig();
	let agentsError: string | null = null;
	const loadedAgents = config === null ? {agents: [], orchestrator: null} : await loadAgents({workingDirectory: config.project.workingDirectory}).then((result) => ({
		agents: result.agents,
		orchestrator: result.orchestrator
	})).catch((error: unknown) => {
		agentsError = error instanceof Error ? error.message : String(error);
		return {agents: [], orchestrator: null};
	});
	const memoryStats = await getMemoryStats(config);
	const instance = render(<Dashboard agents={loadedAgents.agents} agentsError={agentsError} config={config} memoryStats={memoryStats} orchestrator={loadedAgents.orchestrator} version={getVersion()} />);
	await instance.waitUntilExit();
}

async function runValidate(options: ValidateCommandOptions): Promise<void> {
	const config = await loadConfig();
	const workingDirectory = config?.project.workingDirectory ?? process.cwd();
	const result = await loadAgents({workingDirectory, filePath: options.file, requireFile: true});

	console.log(chalk.green(`${APP_NAME} agent config is valid.`));
	console.log(`File: ${result.filePath}`);
	console.log(`Agents: ${result.agents.length}`);
	console.log(`Orchestrator: ${result.orchestrator === null ? 'not configured' : `${result.orchestrator.strategy}, parallel=${result.orchestrator.max_parallel_agents}, iterations=${result.orchestrator.max_iterations}`}`);

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
			toolContext: {
				workingDirectory: config.project.workingDirectory,
				approvalMode: getApprovalMode(options.yes),
				onPreview: (preview) => {
					console.log(preview);
				}
			},
			onToolStart: printToolStart,
			onToolFinish: printToolFinish,
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
				toolContext: {
					workingDirectory: config.project.workingDirectory,
					approvalMode: getApprovalMode(options.yes),
					onPreview: (preview) => {
						console.log(preview);
					}
				},
				onToolStart: printToolStart,
				onToolFinish: printToolFinish,
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

async function runTask(task: string, options: RunCommandOptions): Promise<void> {
	const config = await loadConfig();

	if (config === null) {
		throw new Error(`${APP_NAME} is not configured yet. Run ${COMMAND_NAME} init first.`);
	}

	const {agents, orchestrator} = await loadAgents({workingDirectory: config.project.workingDirectory, requireFile: true});

	if (options.multi === true) {
		const effectiveOrchestrator = orchestrator ?? {
			strategy: 'plan_and_execute' as const,
			max_parallel_agents: 3,
			max_iterations: 10
		};
		let approved = true;
		const llmClient = new AiSdkLlmClient();
		const plan = await planMultiAgentTaskDynamically({
			config,
			task,
			agents,
			orchestrator: effectiveOrchestrator,
			llmClient
		});
		printPlan(plan);

		if (process.stdin.isTTY === true && options.yes !== true) {
			approved = await confirm({
				message: 'Run this multi-agent plan?',
				default: true
			});
		}

		if (!approved) {
			console.log(chalk.yellow('Multi-agent run cancelled.'));
			return;
		}

		const finalResult = await runMultiAgentTask({
			config,
			agents,
			orchestrator: effectiveOrchestrator,
			task,
			plan,
			approvalMode: getApprovalMode(options.yes),
			llmClient,
			callbacks: {
				onMessage: (message) => {
					console.log(chalk.gray(`[${message.type}] ${message.from} -> ${message.to}`));
				},
				onExecutionEvent: (event) => {
					if (event.type === 'tool_started') {
						console.log(chalk.cyan(`tool -> ${event.stepId} ${event.toolName}`));
					}

					if (event.type === 'tool_finished') {
						console.log(chalk.cyan(`tool <- ${event.stepId} ${event.toolName} ${event.status} ${event.durationMs}ms`));
					}
				},
				onStepStart: (step) => {
					console.log(chalk.cyan(`starting ${step.id} with ${step.agentName}`));
				},
				onStepFinish: (record) => {
					const color = record.status === 'succeeded' ? chalk.green : chalk.red;
					console.log(color(`finished ${record.stepId} ${record.status} ${record.durationMs}ms`));
				}
			}
		});

		console.log(chalk.bold(finalResult.finalOutput));
		console.log(`Session: ${finalResult.sessionPath}`);

		if (!finalResult.success) {
			process.exitCode = 1;
		}

		return;
	}

	const agent = options.agent === undefined ? agents[0] : findAgent(agents, options.agent);

	if (agent === undefined) {
		throw new Error('No agents are configured. Create agents.yaml and run polyagent validate.');
	}

	await runAgentTurn({
		config,
		agent,
		message: task,
		conversation: [],
		toolContext: {
			workingDirectory: config.project.workingDirectory,
			approvalMode: getApprovalMode(options.yes),
			onPreview: (preview) => {
				console.log(preview);
			}
		},
		onToolStart: printToolStart,
		onToolFinish: printToolFinish,
		onToken: (token) => {
			process.stdout.write(token);
		}
	});
	process.stdout.write('\n');
}

async function runReplay(sessionId: string, options: ReplayCommandOptions): Promise<void> {
	const config = await loadConfig();

	if (config === null) {
		throw new Error(`${APP_NAME} is not configured yet. Run ${COMMAND_NAME} init first.`);
	}

	const speed = Math.max(Number(options.speed ?? '1'), 0.1);
	const delayMs = Math.round(250 / speed);
	const {filePath, session} = await loadRecordedSession(config.project.workingDirectory, sessionId);

	console.log(chalk.bold(`${APP_NAME} replay`));
	console.log(`File: ${filePath}`);
	console.log(`Task: ${session.task}`);
	printPlan(session.plan);

	for (const message of session.messages) {
		console.log(chalk.gray(`[${String(message.timestamp)}] ${message.type}: ${message.from} -> ${message.to}`));
		await new Promise((resolve) => {
			setTimeout(resolve, delayMs);
		});
	}

	for (const event of session.executionEvents) {
		console.log(`${event.type}: ${event.agentName}/${event.stepId}`);
		await new Promise((resolve) => {
			setTimeout(resolve, delayMs);
		});
	}

	console.log(chalk.green(session.success ? 'Replay complete: success' : 'Replay complete: failed'));
	console.log(session.finalOutput);

	if (process.stdout.isTTY === true) {
		const instance = render(<MultiAgentSessionView session={session} version={getVersion()} />);
		await instance.waitUntilExit();
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
		console.log(boxen([
			`${APP_NAME} is not configured yet.`,
			`Run ${chalk.cyan(`${COMMAND_NAME} init`)} to start.`,
			`Config path checked: ${getConfigPath()}`
		].join('\n'), {
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
		.option('-y, --yes', 'Auto-approve tool calls that require confirmation.')
		.action(async (agentName: string, options: ChatCommandOptions) => {
			await runChat(agentName, options);
		});

	program
		.command('run')
		.description('Run a task against the first configured agent, or with the multi-agent orchestrator.')
		.argument('<task>', 'Task to run.')
		.option('--agent <name>', 'Run the task with a specific agent instead of the first one.')
		.option('--multi', 'Run with the configured multi-agent orchestrator.')
		.option('-y, --yes', 'Auto-approve write and command tool calls.')
		.action(async (task: string, options: RunCommandOptions) => {
			await runTask(task, options);
		});

	program
		.command('replay')
		.description('Replay a recorded multi-agent session.')
		.argument('<session-id-or-path>', 'Session id from .polyagent/sessions, or a JSON file path.')
		.option('--speed <number>', 'Replay speed multiplier.', '1')
		.action(async (sessionId: string, options: ReplayCommandOptions) => {
			await runReplay(sessionId, options);
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
