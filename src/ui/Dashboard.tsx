import path from 'node:path';
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, useInput, useStdin} from 'ink';
import TextInput from 'ink-text-input';
import type {ModelMessage} from 'ai';
import type {AgentDefinition, OrchestratorConfig} from '../agents/schema.js';
import {loadAgents} from '../agents/load.js';
import {saveAgentsFile, upsertAgentDefinition} from '../agents/manage.js';
import {APP_NAME, COMMAND_NAME, type PolycodeConfig} from '../domain.js';
import type {MemoryStats} from '../memory/types.js';
import {getConfigPath} from '../config/store.js';
import {runAgentTurn, type LlmClient} from '../chat/run.js';
import {runMultiAgentTask, type AgentRuntimeStatus} from '../orchestration/run.js';
import {createExecutionSession, type ExecutionEvent} from '../runtime/execution.js';
import type {ToolApprovalMode, WebSearchProvider} from '../tools/types.js';
import {
	disableMouseTrackingSequence,
	enableMouseTrackingSequence,
	parseTerminalMouseEvents,
	stripTerminalMouseSequences,
	type TerminalMouseEvent
} from './mouse.js';
import {Panel} from './Panel.js';

type DashboardProps = {
	agents?: AgentDefinition[];
	agentsError?: string | null;
	config: PolycodeConfig | null;
	initialInputValue?: string;
	initialModal?: Modal;
	interactive?: boolean;
	llmClient?: LlmClient;
	memoryStats?: MemoryStats;
	orchestrator?: OrchestratorConfig | null;
	version: string;
};

type ActivePanel = 'agents' | 'session' | 'inspector';
type Modal = 'agent' | 'help' | 'settings' | null;
type RunMode = 'single' | 'multi';
type EntryKind = 'assistant' | 'error' | 'message' | 'preview' | 'steps' | 'system' | 'tool' | 'user';

type TranscriptEntry = {
	id: number;
	kind: EntryKind;
	source?: string;
	text: string;
};

type PendingApproval = {
	message: string;
	resolve: (approved: boolean) => void;
};

type AgentDraft = {
	name: string;
	role: string;
	goal: string;
	model: string;
	tools: string;
	memoryEnabled: boolean;
};

type SlashAction = {
	id: string;
	title: string;
	detail: string;
	search: string;
	run: () => void;
};

const spinnerFrames = ['|', '/', '-', '\\'];
const approvalModes: ToolApprovalMode[] = ['prompt', 'allow', 'deny'];
const runModes: RunMode[] = ['single', 'multi'];
const webSearchProviders: WebSearchProvider[] = ['auto', 'duckduckgo', 'tavily'];
const plannerStrategies: OrchestratorConfig['strategy'][] = ['dynamic', 'plan_and_execute', 'sequential', 'react'];
const fallbackOrchestrator: OrchestratorConfig = {
	strategy: 'dynamic',
	max_parallel_agents: 3,
	max_iterations: 10
};

const defaultAgentDraft: AgentDraft = {
	name: '',
	role: 'Project-aware coding assistant',
	goal: 'Help the user inspect, understand, and change this project accurately',
	model: '',
	tools: 'read_file, write_file, append_to_file, list_directory, search_files, execute_command, web_search, fetch_url',
	memoryEnabled: true
};

function useTerminalSize(): [number, number] {
	const [size, setSize] = useState<[number, number]>([
		process.stdout.columns ?? 100,
		process.stdout.rows ?? 30
	]);

	useEffect(() => {
		const updateSize = (): void => {
			setSize([
				process.stdout.columns ?? 100,
				process.stdout.rows ?? 30
			]);
		};

		updateSize();
		const canListenForResize = process.stdout.isTTY && typeof process.stdout.on === 'function' && typeof process.stdout.off === 'function';

		if (canListenForResize) {
			try {
				process.stdout.on('resize', updateSize);
			} catch {
				return undefined;
			}
		}

		return () => {
			if (canListenForResize) {
				try {
					process.stdout.off('resize', updateSize);
				} catch {
					// Test streams can expose partial TTY APIs.
				}
			}
		};
	}, []);

	return size;
}

function cycleValue<T>(values: readonly T[], current: T, direction: 1 | -1): T {
	const index = values.findIndex((value) => value === current);
	const nextIndex = (Math.max(index, 0) + direction + values.length) % values.length;
	return values[nextIndex]!;
}

function truncate(value: string, maxLength = 3600): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(Math.max(value.length - maxLength, 0))}`;
}

function splitTools(value: string): string[] {
	return value.split(',').map((tool) => tool.trim()).filter((tool) => tool.length > 0);
}

function oneLine(value: string, maxLength: number): string {
	const normalized = value.replace(/\s+/g, ' ').trim();

	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function tailPath(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `...${value.slice(Math.max(value.length - maxLength + 3, 0))}`;
}

function summarizeTools(tools: string[], maxLength: number): string {
	if (tools.length === 0) {
		return 'none';
	}

	return oneLine(tools.join(', '), maxLength);
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function toolInputString(input: unknown, key: string): string | undefined {
	const value = asRecord(input)[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function compactToolActivity(toolName: string, input: unknown): string {
	if (toolName === 'web_search') {
		return `Searching the web for "${oneLine(toolInputString(input, 'query') ?? 'query', 80)}"`;
	}

	if (toolName === 'fetch_url') {
		return `Fetching ${oneLine(toolInputString(input, 'url') ?? 'URL', 90)}`;
	}

	if (toolName === 'read_file') {
		return `Reading ${oneLine(toolInputString(input, 'path') ?? 'file', 80)}`;
	}

	if (toolName === 'write_file') {
		return `Writing ${oneLine(toolInputString(input, 'path') ?? 'file', 80)}`;
	}

	if (toolName === 'append_to_file') {
		return `Appending to ${oneLine(toolInputString(input, 'path') ?? 'file', 80)}`;
	}

	if (toolName === 'list_directory') {
		return `Listing ${oneLine(toolInputString(input, 'path') ?? '.', 80)}`;
	}

	if (toolName === 'search_files') {
		return `Searching files for "${oneLine(toolInputString(input, 'pattern') ?? 'pattern', 80)}"`;
	}

	if (toolName === 'execute_command') {
		return `Running command "${oneLine(toolInputString(input, 'command') ?? 'command', 80)}"`;
	}

	return `Using ${toolName}`;
}

function entryColor(kind: EntryKind): string | undefined {
	if (kind === 'assistant') {
		return 'white';
	}

	if (kind === 'error') {
		return 'red';
	}

	if (kind === 'message') {
		return 'magenta';
	}

	if (kind === 'preview') {
		return 'yellow';
	}

	if (kind === 'steps') {
		return 'cyan';
	}

	if (kind === 'system') {
		return 'gray';
	}

	if (kind === 'tool') {
		return 'cyan';
	}

	return 'green';
}

function entryLabel(entry: TranscriptEntry): string {
	if (entry.source !== undefined) {
		return entry.source;
	}

	if (entry.kind === 'assistant') {
		return 'assistant';
	}

	if (entry.kind === 'error') {
		return 'error';
	}

	if (entry.kind === 'message') {
		return 'message';
	}

	if (entry.kind === 'preview') {
		return 'preview';
	}

	if (entry.kind === 'steps') {
		return 'steps';
	}

	if (entry.kind === 'system') {
		return 'system';
	}

	if (entry.kind === 'tool') {
		return 'tool';
	}

	return 'you';
}

function statusIcon(status: AgentRuntimeStatus | 'idle', isSelected: boolean, spinnerFrame: string): string {
	if (status === 'running') {
		return spinnerFrame;
	}

	if (status === 'succeeded') {
		return '*';
	}

	if (status === 'failed') {
		return '!';
	}

	return isSelected ? '>' : ' ';
}

function formatPlanSummary(task: string, steps: Array<{id: string; title: string; agentName: string; dependsOn: string[]}>): string {
	return [
		`Plan for: ${task}`,
		...steps.map((step, index) => {
			const dependencies = step.dependsOn.length === 0 ? 'none' : step.dependsOn.join(', ');
			return `${index + 1}. ${step.id} -> ${step.agentName}: ${step.title} (depends: ${dependencies})`;
		})
	].join('\n');
}

export function Dashboard({
	agents = [],
	agentsError = null,
	config,
	initialInputValue = '',
	initialModal = null,
	interactive = true,
	llmClient,
	memoryStats,
	orchestrator = null,
	version
}: DashboardProps): JSX.Element {
	const {exit} = useApp();
	const {isRawModeSupported} = useStdin();
	const inputEnabled = interactive && isRawModeSupported === true;
	const [columns, rows] = useTerminalSize();
	const [configuredAgents, setConfiguredAgents] = useState<AgentDefinition[]>(agents);
	const [agentConfigError, setAgentConfigError] = useState<string | null>(agentsError);
	const [currentOrchestrator, setCurrentOrchestrator] = useState<OrchestratorConfig | null>(orchestrator);
	const [activePanel, setActivePanel] = useState<ActivePanel>('session');
	const [modal, setModal] = useState<Modal>(initialModal);
	const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
	const [inputValue, setInputValue] = useState(initialInputValue);
	const [slashIndex, setSlashIndex] = useState(0);
	const [settingsIndex, setSettingsIndex] = useState(0);
	const [agentFieldIndex, setAgentFieldIndex] = useState(0);
	const [agentDraft, setAgentDraft] = useState<AgentDraft>(defaultAgentDraft);
	const [runMode, setRunMode] = useState<RunMode>('single');
	const [approvalMode, setApprovalMode] = useState<ToolApprovalMode>('prompt');
	const [webSearchProvider, setWebSearchProvider] = useState<WebSearchProvider>('auto');
	const [memoryVisible, setMemoryVisible] = useState(true);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [isRunning, setIsRunning] = useState(false);
	const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
	const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentRuntimeStatus>>({});
	const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
	const [spinnerIndex, setSpinnerIndex] = useState(0);
	const conversationsRef = useRef<Record<string, ModelMessage[]>>({});
	const multiStreamEntriesRef = useRef<Record<string, number>>({});
	const nextEntryIdRef = useRef(1);
	const currentRunStepLabelsRef = useRef<string[]>([]);
	const currentRunToolEntryIdsRef = useRef<Set<number>>(new Set());
	const currentRunToolEntriesByCallRef = useRef<Map<string, number>>(new Map());

	useEffect(() => {
		setConfiguredAgents(agents);
		setSelectedAgentIndex((index) => Math.min(index, agents.length));
	}, [agents]);

	useEffect(() => {
		setAgentConfigError(agentsError);
	}, [agentsError]);

	useEffect(() => {
		setCurrentOrchestrator(orchestrator);
	}, [orchestrator]);

	useEffect(() => {
		if (!isRunning) {
			return undefined;
		}

		const timer = setInterval(() => {
			setSpinnerIndex((index) => (index + 1) % spinnerFrames.length);
		}, 120);

		return () => {
			clearInterval(timer);
		};
	}, [isRunning]);

	useEffect(() => {
		if (inputEnabled) {
			return undefined;
		}

		const timeout = setTimeout(() => {
			exit();
		}, 50);

		return () => {
			clearTimeout(timeout);
		};
	}, [exit, inputEnabled]);

	useEffect(() => {
		if (!inputEnabled || !process.stdout.isTTY) {
			return undefined;
		}

		process.stdout.write(enableMouseTrackingSequence);

		return () => {
			process.stdout.write(disableMouseTrackingSequence);
		};
	}, [inputEnabled]);

	const appendEntry = (kind: EntryKind, text: string, source?: string): number => {
		const id = nextEntryIdRef.current;
		nextEntryIdRef.current += 1;
		setTranscript((entries) => [...entries, {id, kind, source, text: truncate(text)}]);
		setScrollOffset(0);
		return id;
	};

	const updateEntry = (id: number, updater: (text: string) => string): void => {
		setTranscript((entries) => entries.map((entry) => entry.id === id ? {...entry, text: truncate(updater(entry.text))} : entry));
	};

	const beginRunSteps = (): void => {
		currentRunStepLabelsRef.current = [];
		currentRunToolEntryIdsRef.current = new Set();
		currentRunToolEntriesByCallRef.current = new Map();
	};

	const collapseRunSteps = (beforeEntryId?: number): void => {
		const steps = currentRunStepLabelsRef.current;
		const toolEntryIds = currentRunToolEntryIdsRef.current;

		if (steps.length === 0) {
			return;
		}

		const id = nextEntryIdRef.current;
		nextEntryIdRef.current += 1;
		const entry: TranscriptEntry = {
			id,
			kind: 'steps',
			source: 'steps',
			text: [
				`Steps taken (${steps.length})`,
				...steps.map((step, index) => `${index + 1}. ${step}`)
			].join('\n')
		};

		setTranscript((entries) => {
			const filtered = entries.filter((candidate) => !toolEntryIds.has(candidate.id));
			const insertIndex = beforeEntryId === undefined ? -1 : filtered.findIndex((candidate) => candidate.id === beforeEntryId);

			if (insertIndex === -1) {
				return [...filtered, entry];
			}

			return [
				...filtered.slice(0, insertIndex),
				entry,
				...filtered.slice(insertIndex)
			];
		});
		currentRunStepLabelsRef.current = [];
		currentRunToolEntryIdsRef.current = new Set();
		currentRunToolEntriesByCallRef.current = new Map();
	};

	const selectedAgent = configuredAgents[Math.min(selectedAgentIndex, Math.max(configuredAgents.length - 1, 0))];
	const addAgentSelected = selectedAgentIndex >= configuredAgents.length;
	const isSetupMissing = config === null;
	const isAgentsMissing = config !== null && agentConfigError === null && configuredAgents.length === 0;
	const workingDirectory = config?.project.workingDirectory ?? process.cwd();
	const projectName = config?.project.name ?? 'No project configured';
	const expectedAgentsFile = config === null ? null : path.join(config.project.workingDirectory, 'agents.yaml');
	const effectiveOrchestrator = currentOrchestrator ?? fallbackOrchestrator;
	const canRun = config !== null && selectedAgent !== undefined && agentConfigError === null;
	const panelHeight = Math.max(rows - 5, 16);
	const sidebarWidth = Math.min(Math.max(Math.floor(columns * 0.23), 28), 38);
	const inspectorWidth = Math.min(Math.max(Math.floor(columns * 0.25), 30), 42);
	const showInspector = columns >= 100;
	const inspectorTextWidth = Math.max(inspectorWidth - 6, 16);
	const transcriptHeight = Math.max(panelHeight - 7, 7);
	const visibleTranscript = transcript.slice(
		Math.max(0, transcript.length - transcriptHeight - scrollOffset),
		Math.max(0, transcript.length - scrollOffset)
	);
	const status = isSetupMissing ? 'Setup needed' : pendingApproval !== null ? 'Approval needed' : isRunning ? 'Running' : agentConfigError !== null || isAgentsMissing ? 'Needs attention' : 'Ready';
	const spinnerFrame = spinnerFrames[spinnerIndex]!;
	const selectedAgentName = selectedAgent?.name ?? 'agent';
	const promptPlaceholder = canRun
		? runMode === 'multi'
			? 'Ask the agent team to...'
			: `Ask ${selectedAgentName} to...`
		: `Run ${COMMAND_NAME} init or create an agent`;

	const refreshAgents = async (): Promise<void> => {
		if (config === null) {
			appendEntry('error', `${APP_NAME} is not configured yet. Run ${COMMAND_NAME} init first.`);
			return;
		}

		try {
			const result = await loadAgents({workingDirectory: config.project.workingDirectory, requireFile: true});
			setConfiguredAgents(result.agents);
			setCurrentOrchestrator(result.orchestrator);
			setAgentConfigError(null);
			appendEntry('system', `Loaded ${result.agents.length} agent(s) from ${result.filePath}.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setAgentConfigError(message);
			appendEntry('error', message);
		}
	};

	const persistOrchestrator = async (orchestratorConfig: OrchestratorConfig): Promise<void> => {
		if (config === null || configuredAgents.length === 0) {
			setCurrentOrchestrator(orchestratorConfig);
			return;
		}

		try {
			const result = await saveAgentsFile({
				workingDirectory: config.project.workingDirectory,
				agents: configuredAgents,
				orchestrator: orchestratorConfig
			});
			setCurrentOrchestrator(result.orchestrator);
			setAgentConfigError(null);
		} catch (error) {
			appendEntry('error', error instanceof Error ? error.message : String(error));
		}
	};

	const cyclePlannerStrategy = (direction: 1 | -1): void => {
		const nextOrchestrator = {
			...effectiveOrchestrator,
			strategy: cycleValue(plannerStrategies, effectiveOrchestrator.strategy, direction)
		};

		setCurrentOrchestrator(nextOrchestrator);
		void persistOrchestrator(nextOrchestrator);
	};

	const openAgentModal = (): void => {
		setAgentDraft({
			...defaultAgentDraft,
			name: configuredAgents.length === 0 ? 'researcher' : `agent_${configuredAgents.length + 1}`
		});
		setAgentFieldIndex(0);
		setModal('agent');
	};

	const saveAgentFromModal = async (): Promise<void> => {
		if (config === null) {
			appendEntry('error', `${APP_NAME} is not configured yet. Run ${COMMAND_NAME} init first.`);
			return;
		}

		const agent: AgentDefinition = {
			name: agentDraft.name.trim(),
			role: agentDraft.role.trim(),
			goal: agentDraft.goal.trim(),
			tools: splitTools(agentDraft.tools),
			memory_enabled: agentDraft.memoryEnabled,
			...(agentDraft.model.trim().length > 0 ? {model: agentDraft.model.trim()} : {})
		};

		try {
			const result = await upsertAgentDefinition({
				workingDirectory: config.project.workingDirectory,
				agent,
				orchestrator: currentOrchestrator
			});
			setConfiguredAgents(result.agents);
			setCurrentOrchestrator(result.orchestrator);
			setSelectedAgentIndex(result.agents.findIndex((candidate) => candidate.name === agent.name));
			setAgentConfigError(null);
			setModal(null);
			appendEntry('system', `Saved agent "${agent.name}" to ${result.filePath}.`);
		} catch (error) {
			appendEntry('error', error instanceof Error ? error.message : String(error));
		}
	};

	const requestApprovalInUi = (message: string, preview?: string): Promise<boolean> => new Promise((resolve) => {
		if (preview !== undefined && preview.length > 0) {
			appendEntry('preview', preview);
		}

		setPendingApproval({message, resolve});
	});

	const handleExecutionEvent = (event: ExecutionEvent): void => {
		if (event.type === 'tool_started') {
			const label = compactToolActivity(event.toolName, event.input);
			const entryId = appendEntry('tool', `${label}...`, event.agentName);
			currentRunStepLabelsRef.current.push(label);
			currentRunToolEntryIdsRef.current.add(entryId);
			currentRunToolEntriesByCallRef.current.set(event.toolCallId, entryId);
			return;
		}

		if (event.type === 'tool_finished') {
			const entryId = currentRunToolEntriesByCallRef.current.get(event.toolCallId);
			const label = compactToolActivity(event.toolName, event.input);
			const statusLabel = event.success ? 'done' : 'failed';

			if (entryId === undefined) {
				const fallbackEntryId = appendEntry('tool', `${label} ${statusLabel} (${event.durationMs}ms)`, event.agentName);
				currentRunToolEntryIdsRef.current.add(fallbackEntryId);
			} else {
				updateEntry(entryId, () => `${label} ${statusLabel} (${event.durationMs}ms)`);
			}
		}
	};

	const runSingleAgentPrompt = (message: string): void => {
		if (!canRun || config === null || selectedAgent === undefined) {
			appendEntry('error', `Polycode is not ready yet. Use [+] New agent or run ${COMMAND_NAME} init.`);
			return;
		}

		const agent = selectedAgent;
		const conversation = conversationsRef.current[agent.name] ?? [];
		conversationsRef.current[agent.name] = conversation;
		beginRunSteps();
		appendEntry('user', message);
		const assistantEntryId = appendEntry('assistant', '', agent.name);
		const session = createExecutionSession({
			onEvent: handleExecutionEvent
		});

		setAgentStatuses((statuses) => ({...statuses, [agent.name]: 'running'}));
		setIsRunning(true);

		void runAgentTurn({
			config,
			agent,
			message,
			conversation,
			llmClient,
			session,
			toolContext: {
				workingDirectory: config.project.workingDirectory,
				approvalMode,
				webSearchProvider,
				requestApproval: requestApprovalInUi,
				onPreview: (preview) => {
					appendEntry('preview', preview);
				}
			},
			onToken: (token) => {
				updateEntry(assistantEntryId, (text) => text + token);
			}
		}).then(() => {
			collapseRunSteps(assistantEntryId);
			setAgentStatuses((statuses) => ({...statuses, [agent.name]: 'succeeded'}));
		}).catch((error: unknown) => {
			collapseRunSteps(assistantEntryId);
			updateEntry(assistantEntryId, (text) => text.length === 0 ? '(no response)' : text);
			appendEntry('error', error instanceof Error ? error.message : String(error));
			setAgentStatuses((statuses) => ({...statuses, [agent.name]: 'failed'}));
		}).finally(() => {
			setIsRunning(false);
		});
	};

	const runMultiAgentPrompt = (message: string): void => {
		if (config === null || configuredAgents.length === 0 || agentConfigError !== null) {
			appendEntry('error', `Multi-agent mode needs configured agents. Use [+] New agent or run ${COMMAND_NAME} init.`);
			return;
		}

		beginRunSteps();
		appendEntry('user', message);
		appendEntry('system', `Starting ${effectiveOrchestrator.strategy} orchestration with ${configuredAgents.length} agent(s).`);
		multiStreamEntriesRef.current = {};
		setAgentStatuses(Object.fromEntries(configuredAgents.map((agent) => [agent.name, 'idle'])));
		setIsRunning(true);

		void runMultiAgentTask({
			config,
			agents: configuredAgents,
			orchestrator: effectiveOrchestrator,
			task: message,
			approvalMode,
			webSearchProvider,
			llmClient,
			toolContext: {
				requestApproval: requestApprovalInUi,
				onPreview: (preview) => {
					appendEntry('preview', preview);
				}
			},
			callbacks: {
				onPlan: (plan) => {
					appendEntry('system', `${formatPlanSummary(message, plan.steps)}\nsource: ${plan.source}`);
				},
				onMessage: (agentMessage) => {
					appendEntry('message', `${agentMessage.type}: ${agentMessage.from} -> ${agentMessage.to}`, 'bus');
				},
				onExecutionEvent: handleExecutionEvent,
				onStepStart: (step) => {
					appendEntry('system', `${step.agentName} started ${step.id}: ${step.title}`);
				},
				onStepFinish: (record) => {
					appendEntry(record.status === 'failed' ? 'error' : 'assistant', record.error ?? record.output, record.agentName);
				},
				onToken: (agentName, token) => {
					let entryId = multiStreamEntriesRef.current[agentName];

					if (entryId === undefined) {
						entryId = appendEntry('assistant', '', agentName);
						multiStreamEntriesRef.current[agentName] = entryId;
					}

					updateEntry(entryId, (text) => text + token);
				},
				onAgentStatus: (agentName, statusValue) => {
					setAgentStatuses((statuses) => ({...statuses, [agentName]: statusValue}));
				}
			}
		}).then((result) => {
			collapseRunSteps();
			appendEntry(result.success ? 'system' : 'error', result.finalOutput, 'orchestrator');
			if (result.sessionPath !== null) {
				appendEntry('system', `Session recorded: ${result.sessionPath}`);
			}
		}).catch((error: unknown) => {
			collapseRunSteps();
			appendEntry('error', error instanceof Error ? error.message : String(error));
		}).finally(() => {
			setIsRunning(false);
		});
	};

	const submitPrompt = (value: string): void => {
		const message = value.trim();

		if (message.length === 0 || isRunning || pendingApproval !== null) {
			return;
		}

		setInputValue('');

		if (message.startsWith('/')) {
			const action = slashSuggestions[slashIndex] ?? slashSuggestions[0];

			if (action !== undefined) {
				action.run();
			} else {
				appendEntry('error', `No action matched "${message}".`);
			}

			return;
		}

		if (runMode === 'multi') {
			runMultiAgentPrompt(message);
			return;
		}

		runSingleAgentPrompt(message);
	};

	const slashActions: SlashAction[] = [
		{
			id: 'multi',
			title: 'Switch to multi-agent',
			detail: 'Route the next prompt through the orchestrator.',
			search: 'multi agents orchestrator team plan',
			run: () => {
				setRunMode('multi');
				appendEntry('system', 'Run mode set to multi-agent.');
			}
		},
		{
			id: 'single',
			title: 'Switch to single agent',
			detail: 'Route the next prompt to the selected agent.',
			search: 'single chat agent',
			run: () => {
				setRunMode('single');
				appendEntry('system', 'Run mode set to single-agent.');
			}
		},
		{
			id: 'new-agent',
			title: 'Create agent',
			detail: 'Open the in-terminal agent builder.',
			search: 'new create add agent plus',
			run: openAgentModal
		},
		{
			id: 'settings',
			title: 'Settings',
			detail: 'Change run mode, approvals, planner, and web search.',
			search: 'settings configure web approval planner',
			run: () => {
				setSettingsIndex(0);
				setModal('settings');
			}
		},
		{
			id: 'memory',
			title: 'Toggle memory panel',
			detail: 'Show or hide memory status in the inspector.',
			search: 'memory embeddings panel',
			run: () => {
				setMemoryVisible((visible) => !visible);
				setActivePanel('inspector');
			}
		},
		{
			id: 'validate',
			title: 'Validate agents',
			detail: 'Reload and validate agents.yaml without leaving the app.',
			search: 'validate reload agents yaml',
			run: () => {
				void refreshAgents();
			}
		},
		{
			id: 'clear',
			title: 'Clear conversation',
			detail: 'Clear the visible terminal session.',
			search: 'clear reset transcript',
			run: () => {
				setTranscript([]);
				setScrollOffset(0);
			}
		},
		{
			id: 'help',
			title: 'Help',
			detail: 'Show keyboard controls.',
			search: 'help shortcuts controls',
			run: () => {
				setModal('help');
			}
		},
		{
			id: 'exit',
			title: 'Exit',
			detail: 'Close Polycode.',
			search: 'exit quit',
			run: exit
		}
	];

	const slashQuery = inputValue.startsWith('/') ? inputValue.slice(1).trim().toLowerCase() : '';
	const slashSuggestions = inputValue.startsWith('/')
		? slashQuery.length === 0
			? slashActions
			: slashActions.filter((action) => `${action.title} ${action.detail} ${action.search}`.toLowerCase().includes(slashQuery))
		: [];

	useEffect(() => {
		setSlashIndex((index) => Math.min(index, Math.max(slashSuggestions.length - 1, 0)));
	}, [slashSuggestions.length]);

	const settingsRows = [
		{
			label: 'Run mode',
			value: runMode,
			description: runMode === 'multi' ? 'Prompts go to the orchestrated agent team.' : 'Prompts go to the selected agent.',
			change: (direction: 1 | -1) => {
				setRunMode((mode) => cycleValue(runModes, mode, direction));
			}
		},
		{
			label: 'Web search',
			value: webSearchProvider,
			description: webSearchProvider === 'duckduckgo' ? 'No-key local web search provider.' : 'Provider used by the web_search tool.',
			change: (direction: 1 | -1) => {
				setWebSearchProvider((provider) => cycleValue(webSearchProviders, provider, direction));
			}
		},
		{
			label: 'Approvals',
			value: approvalMode,
			description: approvalMode === 'prompt' ? 'Ask before writes and shell commands.' : 'Controls destructive tool calls.',
			change: (direction: 1 | -1) => {
				setApprovalMode((mode) => cycleValue(approvalModes, mode, direction));
			}
		},
		{
			label: 'Planner',
			value: effectiveOrchestrator.strategy,
			description: 'Saved to agents.yaml when agents exist.',
			change: cyclePlannerStrategy
		},
		{
			label: 'Memory panel',
			value: memoryVisible ? 'shown' : 'hidden',
			description: 'Toggles memory stats in the inspector.',
			change: () => {
				setMemoryVisible((visible) => !visible);
			}
		}
	];

	const scrollConversation = (direction: 'up' | 'down'): void => {
		const amount = Math.max(Math.floor(transcriptHeight / 2), 1);

		setScrollOffset((offset) => direction === 'up'
			? Math.min(offset + amount, Math.max(transcript.length - 1, 0))
			: Math.max(offset - amount, 0));
		setActivePanel('session');
	};

	const handleMouseEvent = (event: TerminalMouseEvent): void => {
		const conversationStartX = sidebarWidth + 2;
		const conversationEndX = showInspector ? columns - inspectorWidth - 1 : columns - 1;
		const panelTopY = 2;
		const panelBottomY = panelTopY + panelHeight;

		if ((event.type === 'wheel-up' || event.type === 'wheel-down') && event.x >= conversationStartX && event.x <= conversationEndX && event.y >= panelTopY && event.y <= panelBottomY) {
			scrollConversation(event.type === 'wheel-up' ? 'up' : 'down');
			return;
		}

		if (event.type !== 'press') {
			return;
		}

		if (event.x <= sidebarWidth && event.y >= panelTopY && event.y <= panelBottomY) {
			const agentListStartY = 5;
			const agentRow = event.y - agentListStartY;
			const agentIndex = Math.floor(agentRow / 3);

			if (event.y <= 3 || agentIndex >= configuredAgents.length || agentRow < 0) {
				openAgentModal();
				return;
			}

			if (agentIndex >= 0 && agentIndex < configuredAgents.length) {
				setSelectedAgentIndex(agentIndex);
				setActivePanel('agents');
			}
		}
	};

	useInput((input, key) => {
		const mouseEvents = parseTerminalMouseEvents(input);

		if (mouseEvents.length > 0) {
			for (const event of mouseEvents) {
				handleMouseEvent(event);
			}

			return;
		}

		if (key.ctrl && input === 'c') {
			exit();
			return;
		}

		if (pendingApproval !== null) {
			if (input.toLowerCase() === 'y') {
				pendingApproval.resolve(true);
				appendEntry('system', `Approved: ${pendingApproval.message}`);
				setPendingApproval(null);
				return;
			}

			if (input.toLowerCase() === 'n' || key.escape) {
				pendingApproval.resolve(false);
				appendEntry('system', `Declined: ${pendingApproval.message}`);
				setPendingApproval(null);
				return;
			}
		}

		if (modal === 'settings') {
			if (key.escape) {
				setModal(null);
				return;
			}

			if (key.upArrow) {
				setSettingsIndex((index) => Math.max(index - 1, 0));
				return;
			}

			if (key.downArrow || key.tab) {
				setSettingsIndex((index) => Math.min(index + 1, settingsRows.length - 1));
				return;
			}

			if (key.leftArrow) {
				settingsRows[settingsIndex]?.change(-1);
				return;
			}

			if (key.rightArrow || key.return) {
				settingsRows[settingsIndex]?.change(1);
				return;
			}
		}

		if (modal === 'agent') {
			if (key.escape) {
				setModal(null);
				return;
			}

			if (key.tab || key.downArrow) {
				setAgentFieldIndex((index) => Math.min(index + 1, 4));
				return;
			}

			if (key.upArrow) {
				setAgentFieldIndex((index) => Math.max(index - 1, 0));
				return;
			}

			if (key.ctrl && input.toLowerCase() === 's') {
				void saveAgentFromModal();
				return;
			}
		}

		if (modal === 'help') {
			if (key.escape || key.return || input === 'q') {
				setModal(null);
			}

			return;
		}

		if (inputValue.startsWith('/')) {
			if (key.upArrow) {
				setSlashIndex((index) => Math.max(index - 1, 0));
				return;
			}

			if (key.downArrow) {
				setSlashIndex((index) => Math.min(index + 1, Math.max(slashSuggestions.length - 1, 0)));
				return;
			}
		}

		if (key.pageUp || (key.ctrl && input === 'u')) {
			scrollConversation('up');
			return;
		}

		if (key.pageDown || (key.ctrl && input === 'd')) {
			scrollConversation('down');
			return;
		}

		if (inputValue.length === 0) {
			if (key.upArrow) {
				setSelectedAgentIndex((index) => Math.max(index - 1, 0));
				setActivePanel('agents');
				return;
			}

			if (key.downArrow) {
				setSelectedAgentIndex((index) => Math.min(index + 1, configuredAgents.length));
				setActivePanel('agents');
				return;
			}

			if (key.leftArrow) {
				setActivePanel('agents');
				return;
			}

			if (key.rightArrow) {
				setActivePanel('inspector');
				return;
			}

			if (key.return && addAgentSelected) {
				openAgentModal();
			}
		}
	}, {isActive: inputEnabled});

	const agentFields = [
		{
			label: 'Name',
			value: agentDraft.name,
			setValue: (value: string) => {
				setAgentDraft((draft) => ({...draft, name: value}));
			}
		},
		{
			label: 'Role',
			value: agentDraft.role,
			setValue: (value: string) => {
				setAgentDraft((draft) => ({...draft, role: value}));
			}
		},
		{
			label: 'Goal',
			value: agentDraft.goal,
			setValue: (value: string) => {
				setAgentDraft((draft) => ({...draft, goal: value}));
			}
		},
		{
			label: 'Model',
			value: agentDraft.model,
			setValue: (value: string) => {
				setAgentDraft((draft) => ({...draft, model: value}));
			}
		},
		{
			label: 'Tools',
			value: agentDraft.tools,
			setValue: (value: string) => {
				setAgentDraft((draft) => ({...draft, tools: value}));
			}
		}
	];

	return (
		<Box flexDirection="column" width={columns} minHeight={Math.min(rows, panelHeight + 5)}>
			<Box justifyContent="space-between" paddingX={1}>
				<Text bold color="white" backgroundColor="blue"> {APP_NAME} v{version} </Text>
				<Text color="cyan">{projectName}</Text>
				<Text inverse> {runMode === 'multi' ? 'Multi-agent' : 'Single agent'} </Text>
			</Box>

			<Box flexDirection="row" height={panelHeight}>
				<Panel title="Agents" subtitle="[+] new" active={activePanel === 'agents'} width={sidebarWidth} height={panelHeight}>
					{isSetupMissing && <Text color="yellow">[!] Setup needed</Text>}
					{isSetupMissing && <Text dimColor>{COMMAND_NAME} init</Text>}
					{!isSetupMissing && agentConfigError !== null && <Text color="red">[!] Config error</Text>}
					{!isSetupMissing && agentConfigError !== null && <Text dimColor>{agentConfigError}</Text>}
					{!isSetupMissing && isAgentsMissing && <Text color="yellow">[!] No agents yet</Text>}
					{!isSetupMissing && isAgentsMissing && <Text dimColor>Use [+] New agent</Text>}
					{configuredAgents.map((agent, index) => {
						const selected = index === selectedAgentIndex && !addAgentSelected;
						const statusValue = agentStatuses[agent.name] ?? 'idle';
						const color = statusValue === 'failed' ? 'red' : statusValue === 'running' ? 'cyan' : selected ? 'cyan' : undefined;
						return (
							<Box key={agent.name} flexDirection="column" marginBottom={1}>
								<Text color={color}>
									{statusIcon(statusValue, selected, spinnerFrame)} [{agent.name.slice(0, 1).toUpperCase()}] {agent.name}
								</Text>
								<Text dimColor>  {statusValue} | {agent.tools.length} tools</Text>
							</Box>
						);
					})}
					<Box marginTop={configuredAgents.length === 0 ? 1 : 0}>
						<Text color={addAgentSelected ? 'cyan' : 'green'}>{addAgentSelected ? '>' : ' '} [+] New agent</Text>
					</Box>
				</Panel>

				<Panel
					title="Conversation"
					subtitle={scrollOffset > 0 ? `scroll +${scrollOffset}` : 'live'}
					active={activePanel === 'session'}
					height={panelHeight}
				>
					{isSetupMissing && (
						<Box flexDirection="column">
							<Text bold>Polycode needs setup</Text>
							<Text color="cyan">{COMMAND_NAME} init</Text>
							<Text dimColor>Config path checked: {getConfigPath()}</Text>
						</Box>
					)}
					{isAgentsMissing && expectedAgentsFile !== null && (
						<Box flexDirection="column">
							<Text bold>No agents configured</Text>
							<Text dimColor>Working directory: {workingDirectory}</Text>
							<Text dimColor>Expected: {expectedAgentsFile}</Text>
							<Text color="green">Use /create or click [+] New agent inside this UI.</Text>
						</Box>
					)}
					{!isSetupMissing && !isAgentsMissing && transcript.length === 0 && (
						<Box flexDirection="column">
							<Text bold>{runMode === 'multi' ? 'Ask the agent team anything.' : `Ask ${selectedAgentName} anything.`}</Text>
							<Text dimColor>Try: read package.json and summarize this project</Text>
							<Text dimColor>Try: create a report at ./reports/summary.md</Text>
							<Text dimColor>Press / for searchable actions.</Text>
						</Box>
					)}
					{visibleTranscript.map((entry) => (
						<Box key={entry.id} flexDirection="column" marginBottom={1}>
							<Text bold color={entryColor(entry.kind)}>{entryLabel(entry)}</Text>
							<Text color={entryColor(entry.kind)}>{entry.text.length === 0 ? '...' : entry.text}</Text>
						</Box>
					))}
				</Panel>

				{showInspector && (
					<Panel title="Inspector" subtitle={status} active={activePanel === 'inspector'} width={inspectorWidth} height={panelHeight}>
						<Text bold>Project</Text>
						<Text dimColor wrap="truncate-end">{tailPath(workingDirectory, inspectorTextWidth)}</Text>
						<Text bold>Selected</Text>
						<Text dimColor wrap="truncate-end">{selectedAgent?.name ?? 'none'}</Text>
						{selectedAgent !== undefined && (
							<Box flexDirection="column">
								<Text wrap="truncate-end">{oneLine(selectedAgent.role, inspectorTextWidth)}</Text>
								<Text dimColor wrap="truncate-end">Goal: {oneLine(selectedAgent.goal, Math.max(inspectorTextWidth - 6, 8))}</Text>
								<Text dimColor wrap="truncate-end">Tools: {summarizeTools(selectedAgent.tools, Math.max(inspectorTextWidth - 7, 8))}</Text>
							</Box>
						)}
						<Box marginTop={1} flexDirection="column">
							<Text bold>Runtime</Text>
							<Text dimColor wrap="truncate-end">Provider: {config?.llm.provider ?? 'none'}</Text>
							<Text dimColor wrap="truncate-end">Mode: {runMode}</Text>
							<Text dimColor wrap="truncate-end">Planner: {effectiveOrchestrator.strategy}</Text>
							<Text dimColor wrap="truncate-end">Approvals: {approvalMode}</Text>
							<Text dimColor wrap="truncate-end">Web: {webSearchProvider}</Text>
						</Box>
						{memoryVisible && (
							<Box marginTop={1} flexDirection="column">
								<Text bold>Memory</Text>
								<Text dimColor wrap="truncate-end">{memoryStats?.backend ?? config?.memory.backend ?? 'none'}</Text>
								<Text dimColor wrap="truncate-end">{memoryStats?.totalEmbeddings ?? 0} embeddings</Text>
								<Text dimColor wrap="truncate-end">{memoryStats?.lastAccessedAt ?? 'never'}</Text>
								<Text dimColor wrap="truncate-end">{memoryStats?.status ?? 'unknown'}</Text>
							</Box>
						)}
					</Panel>
				)}
			</Box>

			{inputValue.startsWith('/') && (
				<Box marginX={1} borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="column">
					<Text color="cyan" bold>Actions</Text>
					{slashSuggestions.length === 0 && <Text dimColor>No actions found</Text>}
					{slashSuggestions.slice(0, 7).map((action, index) => (
						<Text key={action.id} color={index === slashIndex ? 'black' : undefined} backgroundColor={index === slashIndex ? 'cyan' : undefined}>
							{index === slashIndex ? '>' : ' '} {action.title} - {action.detail}
						</Text>
					))}
				</Box>
			)}

			{modal === 'settings' && (
				<Box marginX={1} borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
					<Text color="yellow" bold>Settings</Text>
					{settingsRows.map((row, index) => (
						<Box key={row.label} flexDirection="column">
							<Text color={index === settingsIndex ? 'black' : undefined} backgroundColor={index === settingsIndex ? 'yellow' : undefined}>
								{index === settingsIndex ? '>' : ' '} {row.label}: {row.value}
							</Text>
							<Text dimColor>  {row.description}</Text>
						</Box>
					))}
					<Text dimColor>Up/down choose | left/right or Enter change | Esc close</Text>
				</Box>
			)}

			{modal === 'agent' && (
				<Box marginX={1} borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
					<Text color="green" bold>Create Agent</Text>
					{agentFields.map((field, index) => (
						<Box key={field.label}>
							<Text color={index === agentFieldIndex ? 'green' : undefined}>{index === agentFieldIndex ? '>' : ' '} {field.label}: </Text>
							{index === agentFieldIndex ? (
								<TextInput
									value={field.value}
									onChange={(value) => {
										field.setValue(stripTerminalMouseSequences(value));
									}}
									onSubmit={() => {
										if (agentFieldIndex >= agentFields.length - 1) {
											void saveAgentFromModal();
										} else {
											setAgentFieldIndex((nextIndex) => nextIndex + 1);
										}
									}}
									focus={inputEnabled}
								/>
							) : (
								<Text dimColor>{field.value || '(default)'}</Text>
							)}
						</Box>
					))}
					<Text dimColor>Memory: {agentDraft.memoryEnabled ? 'enabled' : 'disabled'} | Ctrl+S save | Esc cancel</Text>
				</Box>
			)}

			{modal === 'help' && (
				<Box marginX={1} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
					<Text color="cyan" bold>Controls</Text>
					<Text>/ opens searchable actions above the prompt</Text>
					<Text>+ or a opens the agent builder</Text>
					<Text>Type /settings, /multi, /single, or /create and press Enter</Text>
					<Text>Mouse wheel scrolls the conversation panel</Text>
					<Text>Click agents to select them, or click [+] New agent to create one</Text>
					<Text>Up/down selects agents when the prompt is empty</Text>
					<Text>PageUp/PageDown scrolls the session</Text>
					<Text>Esc closes popups, Ctrl+C exits</Text>
				</Box>
			)}

			<Box flexDirection="column" paddingX={1}>
				{pendingApproval !== null && (
					<Box>
						<Text color="yellow">Approve? y/n </Text>
						<Text>{pendingApproval.message}</Text>
					</Box>
				)}
				<Box justifyContent="space-between">
					<Box flexGrow={1}>
						<Text color="cyan">&gt; </Text>
						<TextInput
							value={inputValue}
							onChange={(value) => {
								setInputValue(stripTerminalMouseSequences(value));
							}}
							onSubmit={submitPrompt}
							placeholder={promptPlaceholder}
							focus={inputEnabled && modal === null && pendingApproval === null && !isRunning}
						/>
					</Box>
					<Text inverse> {status} </Text>
				</Box>
				<Text dimColor>/ actions | click [+] new agent | mouse wheel scroll | PageUp/PageDown scroll | Ctrl+C exit</Text>
			</Box>
		</Box>
	);
}
