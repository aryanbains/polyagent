import React, {useEffect, useState} from 'react';
import {Box, Text, useApp, useInput, useStdin} from 'ink';
import {APP_NAME, COMMAND_NAME, type PolycodeConfig} from '../domain.js';
import {Panel} from './Panel.js';

type DashboardProps = {
	config: PolycodeConfig | null;
	version: string;
};

type ActivePanel = 'agents' | 'main';

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

export function Dashboard({config, version}: DashboardProps): JSX.Element {
	const {exit} = useApp();
	const {isRawModeSupported} = useStdin();
	const inputEnabled = isRawModeSupported === true;
	const [columns, rows] = useTerminalSize();
	const [activePanel, setActivePanel] = useState<ActivePanel>('main');
	const [helpVisible, setHelpVisible] = useState(false);

	useInput((input, key) => {
		if (input === 'q') {
			exit();
		}

		if (input === '?') {
			setHelpVisible((visible) => !visible);
		}

		if (key.leftArrow) {
			setActivePanel('agents');
		}

		if (key.rightArrow) {
			setActivePanel('main');
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
	const workingDirectory = config?.project.workingDirectory ?? `Run ${COMMAND_NAME} init`;
	const panelHeight = Math.max(rows - 3, 12);
	const sidebarWidth = Math.min(Math.max(Math.floor(columns * 0.28), 24), 34);

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
					<Text dimColor>No agents yet</Text>
					<Text dimColor>Phase 2 will load agents.yaml</Text>
				</Panel>

				<Panel title="Workspace" active={activePanel === 'main'}>
					<Text bold>No agents configured</Text>
					<Box marginTop={1} flexDirection="column">
						<Text>Working directory</Text>
						<Text dimColor>{workingDirectory}</Text>
					</Box>
					<Box marginTop={1} flexDirection="column">
						<Text>Provider</Text>
						<Text dimColor>{config?.llm.provider ?? 'Not configured'}</Text>
					</Box>
					{helpVisible && (
						<Box marginTop={2} borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
							<Text color="yellow" bold>Keyboard</Text>
							<Text>Left/Right: switch panels</Text>
							<Text>?: toggle help</Text>
							<Text>q: quit</Text>
						</Box>
					)}
				</Panel>
			</Box>

			<Box justifyContent="space-between" paddingX={1}>
				<Text inverse>q quit | ? help | left/right panels</Text>
				<Text inverse>Phase 1 shell ready</Text>
			</Box>
		</Box>
	);
}
