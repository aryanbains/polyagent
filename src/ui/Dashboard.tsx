import path from 'node:path';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput, useStdin} from 'ink';
import TextInput from 'ink-text-input';
import type {ModelMessage} from 'ai';
import type {AgentDefinition} from '../agents/schema.js';
import {APP_NAME, COMMAND_NAME, type PolycodeConfig} from '../domain.js';
import type {MemoryStats} from '../memory/types.js';
import {getConfigPath} from '../config/store.js';
import {runAgentTurn, type LlmClient} from '../chat/run.js';
import {summarizeToolOutput} from '../tools/registry.js';
import type {ToolApprovalMode} from '../tools/types.js';
import {Panel} from './Panel.js';

type DashboardProps = {
	agents?: AgentDefinition[];
	agentsError?: string | null;
	config: PolycodeConfig | null;
	llmClient?: LlmClient;
	memoryStats?: MemoryStats;
	version: string;
};

type ActivePanel = 'agents' | 'main' | 'memory';
type EntryKind = 'assistant' | 'error' | 'preview' | 'system' | 'tool' | 'user';

type TranscriptEntry = {
	id: number;
	kind: EntryKind;
	text: string;
};

type PendingApproval = {
	message: string;
	resolve: (approved: boolean) => void;
};

function useTerminalSize(): [number, number] {
	const [size, setSize] = useState<[number, number]>([
		process.stdout.columns ?? 80,
		process.stdout.rows ?? 24
	]);

	useEffect(() => {
		const updateSize = (): void => {
			setSize([
				process.stdout.columns ?? 80,
				process.stdout.rows ?? 24
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
					// Some test and redirected streams expose TTY-like APIs without stable cleanup hooks.
				}
			}
		};
	}, []);

	return size;
}

function entryColor(kind: EntryKind): string | undefined {
	if (kind === 'assistant') {
		return 'white';
	}

	if (kind === 'error') {
		return 'red';
	}

	if (kind === 'preview') {
		return 'yellow';
	}

	if (kind === 'system') {
		return 'gray';
	}

	if (kind === 'tool') {
		return 'cyan';
	}

	return 'green';
}

function entryPrefix(kind: EntryKind): string {
	if (kind === 'assistant') {
		return 'agent';
	}

	if (kind === 'error') {
		return 'error';
	}

	if (kind === 'preview') {
		return 'diff';
	}

	if (kind === 'system') {
		return 'system';
	}

	if (kind === 'tool') {
		return 'tool';
	}

	return 'you';
}

function truncate(value: string, maxLength = 2400): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, maxLength)}\n... truncated ...`;
}

export function Dashboard({agents = [], agentsError = null, config, llmClient, memoryStats, version}: DashboardProps): JSX.Element {
	const {exit} = useApp();
	const {isRawModeSupported} = useStdin();
	const inputEnabled = isRawModeSupported === true;
	const [columns, rows] = useTerminalSize();
	const [activePanel, setActivePanel] = useState<ActivePanel>('main');
	const [helpVisible, setHelpVisible] = useState(false);
	const [memoryVisible, setMemoryVisible] = useState(false);
	const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
	const [inputValue, setInputValue] = useState('');
	const [isRunning, setIsRunning] = useState(false);
	const [approvalMode, setApprovalMode] = useState<ToolApprovalMode>('prompt');
	const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
	const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
	const conversationsRef = useRef<Record<string, ModelMessage[]>>({});
	const nextEntryIdRef = useRef(1);

	const appendEntry = (kind: EntryKind, text: string): number => {
		const id = nextEntryIdRef.current;
		nextEntryIdRef.current += 1;
		setTranscript((entries) => [...entries, {id, kind, text}]);
		return id;
	};

	const updateEntry = (id: number, updater: (text: string) => string): void => {
		setTranscript((entries) => entries.map((entry) => entry.id === id ? {...entry, text: updater(entry.text)} : entry));
	};

	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			exit();
		}

		if (pendingApproval !== null) {
			if (input.toLowerCase() === 'y') {
				pendingApproval.resolve(true);
				appendEntry('system', `Approved: ${pendingApproval.message}`);
				setPendingApproval(null);
			}

			if (input.toLowerCase() === 'n' || key.escape) {
				pendingApproval.resolve(false);
				appendEntry('system', `Declined: ${pendingApproval.message}`);
				setPendingApproval(null);
			}
		}

		if (inputValue.length === 0 && key.upArrow) {
			setSelectedAgentIndex((index) => Math.max(index - 1, 0));
			setActivePanel('agents');
		}

		if (inputValue.length === 0 && key.downArrow) {
			setSelectedAgentIndex((index) => Math.min(index + 1, Math.max(agents.length - 1, 0)));
			setActivePanel('agents');
		}
	}, {isActive: inputEnabled});

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

	const projectName = config?.project.name ?? 'No project configured';
	const workingDirectory = config?.project.workingDirectory ?? process.cwd();
	const expectedAgentsFile = config === null ? null : path.join(config.project.workingDirectory, 'agents.yaml');
	const selectedAgent = agents[selectedAgentIndex];
	const isSetupMissing = config === null;
	const isAgentsMissing = config !== null && agentsError === null && agents.length === 0;
	const canChat = config !== null && selectedAgent !== undefined && agentsError === null;
	const status = isSetupMissing ? 'Setup needed' : isRunning ? 'Running' : pendingApproval !== null ? 'Approval needed' : agentsError === null && !isAgentsMissing ? 'Ready' : 'Needs attention';
	const panelHeight = Math.max(rows - 3, 12);
	const sidebarWidth = Math.min(Math.max(Math.floor(columns * 0.28), 24), 34);
	const memoryWidth = memoryVisible ? Math.min(Math.max(Math.floor(columns * 0.25), 24), 34) : undefined;
	const transcriptHeight = Math.max(panelHeight - 5, 6);
	const visibleTranscript = transcript.slice(-transcriptHeight);
	const activeAgentName = selectedAgent?.name ?? 'agent';
	const emptySessionLines = useMemo(() => {
		if (isSetupMissing) {
			return [
				'Run polycode init once, then reopen polycode.',
				'If you already initialized, check POLYCODE_HOME and the Windows user running this terminal.'
			];
		}

		if (isAgentsMissing) {
			return [
				`No agents.yaml found in ${workingDirectory}.`,
				`Run polycode init again or create ${expectedAgentsFile ?? 'agents.yaml'}, then reopen polycode.`
			];
		}

		if (agentsError !== null) {
			return [
				'Your agent config needs attention.',
				agentsError
			];
		}

		return [
			`Ask ${activeAgentName} anything. Examples:`,
			'fix typecheck errors',
			'list all TypeScript files in src',
			'read package.json and summarize this project',
			'Use /help for commands.'
		];
	}, [activeAgentName, agentsError, expectedAgentsFile, isAgentsMissing, isSetupMissing, workingDirectory]);

	const requestApprovalInUi = (message: string): Promise<boolean> => new Promise((resolve) => {
		setPendingApproval({message, resolve});
	});

	const runCommand = (command: string): void => {
		const [name = '', ...args] = command.slice(1).trim().split(/\s+/);
		const argument = args.join(' ');

		if (name === 'exit' || name === 'quit') {
			exit();
			return;
		}

		if (name === 'help' || name === '?') {
			setHelpVisible((visible) => !visible);
			appendEntry('system', 'Commands: /help, /agents, /agent <name>, /memory, /approve on|off|deny, /clear, /exit');
			return;
		}

		if (name === 'agents') {
			appendEntry('system', agents.length === 0 ? 'No agents configured.' : agents.map((agent, index) => `${index === selectedAgentIndex ? '*' : '-'} ${agent.name}: ${agent.role}`).join('\n'));
			return;
		}

		if (name === 'agent') {
			const agentIndex = agents.findIndex((agent) => agent.name === argument);

			if (agentIndex === -1) {
				appendEntry('error', `Agent "${argument}" was not found. Try /agents.`);
				return;
			}

			setSelectedAgentIndex(agentIndex);
			setActivePanel('agents');
			appendEntry('system', `Switched to ${agents[agentIndex]?.name}.`);
			return;
		}

		if (name === 'memory') {
			setMemoryVisible((visible) => !visible);
			setActivePanel('memory');
			return;
		}

		if (name === 'approve') {
			if (argument === 'on' || argument === 'allow') {
				setApprovalMode('allow');
				appendEntry('system', 'Tool approvals set to allow. File writes and commands can run without y/n prompts.');
				return;
			}

			if (argument === 'deny') {
				setApprovalMode('deny');
				appendEntry('system', 'Tool approvals set to deny. Destructive tools will be refused.');
				return;
			}

			setApprovalMode('prompt');
			appendEntry('system', 'Tool approvals set to prompt. File writes and commands will ask y/n in this UI.');
			return;
		}

		if (name === 'clear') {
			setTranscript([]);
			return;
		}

		appendEntry('error', `Unknown command "/${name}". Use /help.`);
	};

	const submitPrompt = (value: string): void => {
		const message = value.trim();

		if (message.length === 0 || isRunning || pendingApproval !== null) {
			return;
		}

		setInputValue('');

		if (message.startsWith('/')) {
			runCommand(message);
			return;
		}

		if (!canChat || config === null || selectedAgent === undefined) {
			appendEntry('error', `Polycode is not ready yet. Run ${COMMAND_NAME} init and ${COMMAND_NAME} validate first.`);
			return;
		}

		const agent = selectedAgent;
		const conversation = conversationsRef.current[agent.name] ?? [];
		conversationsRef.current[agent.name] = conversation;
		appendEntry('user', message);
		const assistantEntryId = appendEntry('assistant', '');
		setIsRunning(true);

		void runAgentTurn({
			config,
			agent,
			message,
			conversation,
			llmClient,
			toolContext: {
				workingDirectory: config.project.workingDirectory,
				approvalMode,
				requestApproval: requestApprovalInUi,
				onPreview: (preview) => {
					appendEntry('preview', truncate(preview));
				}
			},
			onToolStart: (toolName, input) => {
				appendEntry('tool', `-> ${toolName}(${JSON.stringify(input)})`);
			},
			onToolFinish: (toolName, output, success) => {
				appendEntry('tool', `<-${success ? '' : ' failed'} ${toolName}: ${summarizeToolOutput(output)}`);
			},
			onToken: (token) => {
				updateEntry(assistantEntryId, (text) => text + token);
			}
		}).catch((error: unknown) => {
			updateEntry(assistantEntryId, (text) => text.length === 0 ? '(no response)' : text);
			appendEntry('error', error instanceof Error ? error.message : String(error));
		}).finally(() => {
			setIsRunning(false);
		});
	};

	return (
		<Box flexDirection="column" width={columns} minHeight={Math.min(rows, panelHeight + 2)}>
			<Box justifyContent="space-between" paddingX={1}>
				<Text bold color="white" backgroundColor="blue">
					{APP_NAME} v{version}
				</Text>
				<Text color="cyan">{projectName}</Text>
			</Box>

			<Box flexDirection="row" height={panelHeight}>
				<Panel title="Agents" active={activePanel === 'agents'} width={sidebarWidth}>
					{isSetupMissing && <Text color="yellow">Setup needed</Text>}
					{isSetupMissing && <Text dimColor>Run {COMMAND_NAME} init</Text>}
					{!isSetupMissing && agentsError !== null && <Text color="red">Config error</Text>}
					{!isSetupMissing && agentsError !== null && <Text dimColor>{agentsError}</Text>}
					{!isSetupMissing && isAgentsMissing && <Text color="yellow">No agents found</Text>}
					{!isSetupMissing && isAgentsMissing && <Text dimColor>Expected agents.yaml</Text>}
					{!isSetupMissing && agentsError === null && agents.map((agent, index) => (
						<Text key={agent.name} color={index === selectedAgentIndex ? 'cyan' : undefined}>
							{index === selectedAgentIndex ? '>' : ' '} {agent.name} {isRunning && index === selectedAgentIndex ? 'running' : 'idle'}
						</Text>
					))}
					{!isSetupMissing && agents.length > 0 && (
						<Box marginTop={1} flexDirection="column">
							<Text dimColor>/agents lists agents</Text>
							<Text dimColor>/agent name switches</Text>
						</Box>
					)}
				</Panel>

				<Panel title="Session" active={activePanel === 'main'}>
					{isSetupMissing && (
						<Box flexDirection="column">
							<Text bold>Polycode needs setup</Text>
							<Box marginTop={1} flexDirection="column">
								<Text>Run</Text>
								<Text color="cyan">{COMMAND_NAME} init</Text>
							</Box>
							<Box marginTop={1} flexDirection="column">
								<Text>After init</Text>
								<Text dimColor>{COMMAND_NAME} validate</Text>
								<Text dimColor>{COMMAND_NAME} chat researcher</Text>
								<Text dimColor>{COMMAND_NAME} run "read package.json and summarize this project"</Text>
							</Box>
							<Box marginTop={1} flexDirection="column">
								<Text>Config path checked</Text>
								<Text dimColor>{getConfigPath()}</Text>
							</Box>
							<Text dimColor>Already initialized? Check POLYCODE_HOME and that this terminal is using the same user.</Text>
						</Box>
					)}
					{isAgentsMissing && expectedAgentsFile !== null && (
						<Box flexDirection="column">
							<Text bold>No agents.yaml found</Text>
							<Box marginTop={1} flexDirection="column">
								<Text>Working directory</Text>
								<Text dimColor>{workingDirectory}</Text>
							</Box>
							<Box marginTop={1} flexDirection="column">
								<Text>Expected file</Text>
								<Text dimColor>{expectedAgentsFile}</Text>
							</Box>
							<Box marginTop={1} flexDirection="column">
								<Text>Run</Text>
								<Text color="cyan">{COMMAND_NAME} init</Text>
								<Text dimColor>or create agents.yaml in the working directory, then run {COMMAND_NAME} validate.</Text>
							</Box>
						</Box>
					)}
					{!isSetupMissing && !isAgentsMissing && (
						<Box flexDirection="column">
							<Text bold>{activeAgentName}</Text>
							<Text dimColor>{workingDirectory}</Text>
							{transcript.length === 0 && emptySessionLines.map((line) => (
								<Text key={line} dimColor>{line}</Text>
							))}
							{visibleTranscript.map((entry) => (
								<Box key={entry.id} marginTop={entry.kind === 'user' ? 1 : 0} flexDirection="column">
									<Text color={entryColor(entry.kind)}>
										{entryPrefix(entry.kind)}: {entry.text.length === 0 ? '...' : entry.text}
									</Text>
								</Box>
							))}
						</Box>
					)}
					{helpVisible && (
						<Box marginTop={2} borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
							<Text color="yellow" bold>Commands</Text>
							<Text>/help: toggle this help</Text>
							<Text>/agents: list agents</Text>
							<Text>/agent name: switch agent</Text>
							<Text>/memory: toggle memory panel</Text>
							<Text>/approve on|off|deny: tool approvals</Text>
							<Text>/clear: clear session view</Text>
							<Text>/exit: quit</Text>
						</Box>
					)}
				</Panel>

				{memoryVisible && (
					<Panel title="Memory" active={activePanel === 'memory'} width={memoryWidth}>
						<Text>Backend</Text>
						<Text dimColor>{memoryStats?.backend ?? config?.memory.backend ?? 'none'}</Text>
						<Text>Embeddings</Text>
						<Text dimColor>{memoryStats?.totalEmbeddings ?? 0}</Text>
						<Text>Last access</Text>
						<Text dimColor>{memoryStats?.lastAccessedAt ?? 'never'}</Text>
						<Text>Status</Text>
						<Text dimColor>{memoryStats?.status ?? 'unknown'}</Text>
					</Panel>
				)}
			</Box>

			<Box flexDirection="column" paddingX={1}>
				{pendingApproval !== null && (
					<Box>
						<Text color="yellow">Approve? y/n </Text>
						<Text>{pendingApproval.message}</Text>
					</Box>
				)}
				<Box justifyContent="space-between">
					<Box flexGrow={1}>
						<Text color="cyan">› </Text>
						<TextInput
							value={inputValue}
							onChange={setInputValue}
							onSubmit={submitPrompt}
							placeholder={canChat ? `Ask ${activeAgentName} to...` : `Run ${COMMAND_NAME} init first`}
							focus={inputEnabled && canChat && !isRunning && pendingApproval === null}
						/>
					</Box>
					<Text inverse>{status}</Text>
				</Box>
				<Text dimColor>/help for commands · Ctrl+C exits · approvals {approvalMode}</Text>
			</Box>
		</Box>
	);
}
