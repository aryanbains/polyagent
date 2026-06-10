import path from 'node:path';
import React, {useEffect, useState} from 'react';
import {Box, Text, useApp, useInput, useStdin} from 'ink';
import type {AgentDefinition} from '../agents/schema.js';
import {APP_NAME, COMMAND_NAME, type PolycodeConfig} from '../domain.js';
import type {MemoryStats} from '../memory/types.js';
import {getConfigPath} from '../config/store.js';
import {Panel} from './Panel.js';

type DashboardProps = {
	agents?: AgentDefinition[];
	agentsError?: string | null;
	config: PolycodeConfig | null;
	memoryStats?: MemoryStats;
	version: string;
};

type ActivePanel = 'agents' | 'main' | 'memory';

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

export function Dashboard({agents = [], agentsError = null, config, memoryStats, version}: DashboardProps): JSX.Element {
	const {exit} = useApp();
	const {isRawModeSupported} = useStdin();
	const inputEnabled = isRawModeSupported === true;
	const [columns, rows] = useTerminalSize();
	const [activePanel, setActivePanel] = useState<ActivePanel>('main');
	const [helpVisible, setHelpVisible] = useState(false);
	const [memoryVisible, setMemoryVisible] = useState(false);
	const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);

	useInput((input, key) => {
		if (input === 'q') {
			exit();
		}

		if (input === '?') {
			setHelpVisible((visible) => !visible);
		}

		if (input === 'm') {
			setMemoryVisible((visible) => !visible);
			setActivePanel('memory');
		}

		if (key.leftArrow) {
			setActivePanel('agents');
		}

		if (key.rightArrow) {
			setActivePanel('main');
		}

		if (key.upArrow) {
			setSelectedAgentIndex((index) => Math.max(index - 1, 0));
			setActivePanel('agents');
		}

		if (key.downArrow) {
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
	const status = isSetupMissing ? 'Setup needed' : agentsError === null && !isAgentsMissing ? 'Ready' : 'Needs attention';
	const panelHeight = Math.max(rows - 3, 12);
	const sidebarWidth = Math.min(Math.max(Math.floor(columns * 0.28), 24), 34);
	const memoryWidth = memoryVisible ? Math.min(Math.max(Math.floor(columns * 0.25), 24), 34) : undefined;

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
							{index === selectedAgentIndex ? '>' : ' '} {agent.name} idle
						</Text>
					))}
				</Panel>

				<Panel title="Workspace" active={activePanel === 'main'}>
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
						<>
							<Text bold>{selectedAgent === undefined ? 'No agents configured' : selectedAgent.name}</Text>
							<Box marginTop={1} flexDirection="column">
								<Text>Working directory</Text>
								<Text dimColor>{workingDirectory}</Text>
							</Box>
							<Box marginTop={1} flexDirection="column">
								<Text>Provider</Text>
								<Text dimColor>{config?.llm.provider ?? 'Not configured'}</Text>
							</Box>
							{selectedAgent !== undefined && (
								<Box marginTop={1} flexDirection="column">
									<Text>Role</Text>
									<Text dimColor>{selectedAgent.role}</Text>
									<Text>Goal</Text>
									<Text dimColor>{selectedAgent.goal}</Text>
									<Text>Memory</Text>
									<Text dimColor>{selectedAgent.memory_enabled ? 'enabled' : 'disabled'}</Text>
								</Box>
							)}
						</>
					)}
					{helpVisible && (
						<Box marginTop={2} borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
							<Text color="yellow" bold>Keyboard</Text>
							<Text>Left/Right: switch panels</Text>
							<Text>Up/Down: select agent</Text>
							<Text>m: toggle memory</Text>
							<Text>?: toggle help</Text>
							<Text>q: quit</Text>
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

			<Box justifyContent="space-between" paddingX={1}>
				<Text inverse>q quit | ? help | m memory | arrows navigate</Text>
				<Text inverse>{status}</Text>
			</Box>
		</Box>
	);
}
