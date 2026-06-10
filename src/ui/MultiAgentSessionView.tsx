import React, {useEffect, useState} from 'react';
import {Box, Text, useApp, useInput, useStdin} from 'ink';
import BigText from 'ink-big-text';
import {APP_NAME} from '../domain.js';
import type {RecordedSession} from '../orchestration/session-recorder.js';
import {Panel} from './Panel.js';

type MultiAgentSessionViewProps = {
	session: RecordedSession;
	version: string;
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
			process.stdout.on('resize', updateSize);
		}

		return () => {
			if (canListenForResize) {
				process.stdout.off('resize', updateSize);
			}
		};
	}, []);

	return size;
}

export function MultiAgentSessionView({session, version}: MultiAgentSessionViewProps): JSX.Element {
	const {exit} = useApp();
	const {isRawModeSupported} = useStdin();
	const [columns, rows] = useTerminalSize();
	const panelHeight = Math.max(rows - 6, 14);
	const sidebarWidth = Math.min(Math.max(Math.floor(columns * 0.23), 24), 34);
	const rightWidth = Math.min(Math.max(Math.floor(columns * 0.28), 28), 42);
	const latestMessages = session.messages.slice(-Math.max(panelHeight - 2, 4));
	const latestSteps = session.steps.slice(-Math.max(panelHeight - 2, 4));
	const progress = `${session.steps.filter((step) => step.status === 'succeeded').length}/${session.plan.steps.length}`;

	useInput((input, key) => {
		if (input === 'q' || (key.ctrl && input === 'c')) {
			exit();
		}
	}, {isActive: isRawModeSupported === true});

	useEffect(() => {
		if (isRawModeSupported) {
			return undefined;
		}

		const timeout = setTimeout(() => {
			exit();
		}, 50);

		return () => {
			clearTimeout(timeout);
		};
	}, [exit, isRawModeSupported]);

	return (
		<Box flexDirection="column" width={columns}>
			<Box justifyContent="space-between" paddingX={1}>
				<Text bold color="white" backgroundColor="blue">{APP_NAME} v{version}</Text>
				<Text color={session.success ? 'green' : 'yellow'}>Multi-agent {progress}</Text>
			</Box>
			<Box paddingX={1}>
				<Text>{session.task}</Text>
			</Box>
			<Box flexDirection="row" height={panelHeight}>
				<Panel title="Agents" width={sidebarWidth}>
					{session.plan.steps.map((step) => {
						const record = session.steps.find((candidate) => candidate.stepId === step.id);
						return (
							<Text key={step.id} color={record?.status === 'failed' ? 'red' : record?.status === 'succeeded' ? 'green' : undefined}>
								{step.agentName} {record?.status ?? 'pending'}
							</Text>
						);
					})}
				</Panel>
				<Panel title="Work Graph">
					{latestSteps.map((step) => (
						<Box key={step.stepId} flexDirection="column" marginBottom={1}>
							<Text color={step.status === 'failed' ? 'red' : 'cyan'}>{step.stepId} {'->'} {step.agentName}</Text>
							<Text dimColor>{step.title}</Text>
							<Text>{(step.error ?? step.output).slice(0, 240)}</Text>
						</Box>
					))}
				</Panel>
				<Panel title="Messages" width={rightWidth}>
					{latestMessages.map((message) => (
						<Text key={message.id} color={message.type === 'error' ? 'red' : 'gray'}>
							{message.type}: {message.from} -&gt; {message.to}
						</Text>
					))}
				</Panel>
			</Box>
			<Box justifyContent="space-between" paddingX={1}>
				<Text inverse>agents {session.stats.agentsUsed} | tools {session.stats.toolsCalled} | messages {session.stats.messages}</Text>
				<Text inverse>{session.durationMs}ms</Text>
			</Box>
			{session.success && (
				<Box paddingX={1}>
					<BigText text="DONE" font="tiny" />
				</Box>
			)}
		</Box>
	);
}
