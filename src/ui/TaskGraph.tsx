import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import type {MultiAgentPlan} from '../orchestration/planner.js';
import {computeEdges, computeStepSummary, computeWaves} from '../orchestration/graph.js';
import {stripTerminalMouseSequences} from './mouse.js';

type TaskGraphProps = {
	plan: MultiAgentPlan;
	onApprove: (plan: MultiAgentPlan) => void;
	onEdit: (stepId: string, newPrompt: string) => void;
	onReplan: (reason: string) => void;
	agentNames?: string[];
	interactive?: boolean;
	testInput?: {
		id: number;
		input: string;
		key?: Partial<GraphKey>;
	};
};

type Mode = 'view' | 'edit' | 'edit-dependencies' | 'edit-prompt' | 'replan';
type GraphKey = {
	upArrow: boolean;
	downArrow: boolean;
	return: boolean;
	escape: boolean;
};

const emptyKey: GraphKey = {
	upArrow: false,
	downArrow: false,
	return: false,
	escape: false
};

function truncate(value: string, maxLength: number): string {
	const normalized = value.replace(/\s+/g, ' ').trim();

	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function clonePlan(plan: MultiAgentPlan): MultiAgentPlan {
	return {
		...plan,
		steps: plan.steps.map((step) => ({...step, dependsOn: [...step.dependsOn]}))
	};
}

function cleanInputValue(value: string): string {
	return stripTerminalMouseSequences(value);
}

function uniqueStepId(plan: MultiAgentPlan): string {
	const ids = new Set(plan.steps.map((step) => step.id));
	let index = plan.steps.length + 1;
	let id = `step_${index}`;

	while (ids.has(id)) {
		index += 1;
		id = `step_${index}`;
	}

	return id;
}

export function TaskGraph({agentNames, interactive = true, plan, onApprove, onEdit, onReplan, testInput}: TaskGraphProps): JSX.Element {
	const [mode, setMode] = useState<Mode>('view');
	const [selectedStepIndex, setSelectedStepIndex] = useState(0);
	const [editValue, setEditValue] = useState('');
	const [replanReason, setReplanReason] = useState('');
	const [localPlan, setLocalPlan] = useState<MultiAgentPlan>(() => clonePlan(plan));
	const waves = computeWaves(localPlan.steps);
	const edges = computeEdges(localPlan.steps);
	const selectedStep = localPlan.steps[selectedStepIndex];
	const selectableAgents = agentNames !== undefined && agentNames.length > 0
		? agentNames
		: [...new Set(localPlan.steps.map((step) => step.agentName))];

	useEffect(() => {
		setLocalPlan(clonePlan(plan));
		setSelectedStepIndex(0);
		setEditValue('');
		setReplanReason('');
		setMode('view');
	}, [plan]);

	const saveEdit = (value: string): void => {
		if (selectedStep === undefined) {
			return;
		}

		const nextPlan = {
			...localPlan,
			steps: localPlan.steps.map((step) => step.id === selectedStep.id ? {...step, prompt: value} : step)
		};

		setLocalPlan(nextPlan);
		onEdit(selectedStep.id, value);
		setEditValue('');
		setMode('view');
	};

	const saveDependencies = (value: string): void => {
		if (selectedStep === undefined) {
			return;
		}

		const knownStepIds = new Set(localPlan.steps.map((step) => step.id));
		const dependsOn = value
			.split(',')
			.map((item) => item.trim())
			.filter((item) => item.length > 0 && item !== selectedStep.id && knownStepIds.has(item));

		setLocalPlan((current) => ({
			...current,
			steps: current.steps.map((step) => step.id === selectedStep.id ? {...step, dependsOn} : step)
		}));
		setEditValue('');
		setMode('view');
	};

	const cycleSelectedAgent = (): void => {
		if (selectedStep === undefined || selectableAgents.length === 0) {
			return;
		}

		const index = selectableAgents.indexOf(selectedStep.agentName);
		const nextAgent = selectableAgents[(Math.max(index, 0) + 1) % selectableAgents.length]!;
		setLocalPlan((current) => ({
			...current,
			steps: current.steps.map((step) => step.id === selectedStep.id ? {...step, agentName: nextAgent} : step)
		}));
	};

	const addStepAfterSelected = (): void => {
		const id = uniqueStepId(localPlan);
		const insertIndex = selectedStepIndex + 1;
		const newStep = {
			id,
			title: 'New step',
			agentName: selectedStep?.agentName ?? selectableAgents[0] ?? 'agent',
			prompt: 'Describe this step before approving the plan.',
			dependsOn: selectedStep === undefined ? [] : [selectedStep.id],
			status: 'pending' as const
		};

		setLocalPlan((current) => ({
			...current,
			steps: [
				...current.steps.slice(0, insertIndex),
				newStep,
				...current.steps.slice(insertIndex)
			]
		}));
		setSelectedStepIndex(insertIndex);
	};

	const deleteSelectedStep = (): void => {
		if (selectedStep === undefined || localPlan.steps.length <= 1) {
			return;
		}

		const deletedId = selectedStep.id;
		setLocalPlan((current) => ({
			...current,
			steps: current.steps
				.filter((step) => step.id !== deletedId)
				.map((step) => ({
					...step,
					dependsOn: step.dependsOn.filter((dependency) => dependency !== deletedId)
				}))
		}));
		setSelectedStepIndex((index) => Math.min(index, Math.max(localPlan.steps.length - 2, 0)));
	};

	const handleGraphInput = (input: string, keyInput: Partial<GraphKey>, fromTest = false): void => {
		const key = {...emptyKey, ...keyInput};

		if (mode === 'replan') {
			if (fromTest && key.return) {
				onReplan(replanReason.trim());
				return;
			}

			if (key.escape) {
				setMode('view');
				setReplanReason('');
				return;
			}

			if (fromTest && input.length > 0) {
				setReplanReason((value) => cleanInputValue(value + input));
			}

			return;
		}

		if (mode === 'edit-prompt') {
			if (fromTest && key.return) {
				saveEdit(editValue);
				return;
			}

			if (key.escape) {
				setMode('edit');
				return;
			}

			if (fromTest && input.length > 0) {
				setEditValue((value) => cleanInputValue(value + input));
			}

			return;
		}

		if (mode === 'edit-dependencies') {
			if (fromTest && key.return) {
				saveDependencies(editValue);
				return;
			}

			if (key.escape) {
				setMode('edit');
				return;
			}

			if (fromTest && input.length > 0) {
				setEditValue((value) => cleanInputValue(value + input));
			}

			return;
		}

		if (mode === 'view') {
			if (input.toLowerCase() === 'y' || key.return) {
				onApprove(localPlan);
				return;
			}

			if (input.toLowerCase() === 'e') {
				setMode('edit');
				setSelectedStepIndex(0);
				return;
			}

			if (input.toLowerCase() === 'n') {
				setMode('replan');
				setReplanReason('');
			}

			return;
		}

		if (mode === 'edit') {
			if (key.escape) {
				setMode('view');
				return;
			}

			if (key.upArrow) {
				setSelectedStepIndex((index) => Math.max(index - 1, 0));
				return;
			}

			if (key.downArrow) {
				setSelectedStepIndex((index) => Math.min(index + 1, Math.max(localPlan.steps.length - 1, 0)));
				return;
			}

			if (key.return && selectedStep !== undefined) {
				setEditValue(selectedStep.prompt);
				setMode('edit-prompt');
				return;
			}

			if (input.toLowerCase() === 'a') {
				cycleSelectedAgent();
				return;
			}

			if (input.toLowerCase() === 'd' && selectedStep !== undefined) {
				setEditValue(selectedStep.dependsOn.join(', '));
				setMode('edit-dependencies');
				return;
			}

			if (input === '+') {
				addStepAfterSelected();
				return;
			}

			if (input.toLowerCase() === 'x') {
				deleteSelectedStep();
			}
		}
	};

	useInput((input, key) => {
		handleGraphInput(input, key);
	}, {isActive: interactive});

	useEffect(() => {
		if (testInput === undefined) {
			return;
		}

		handleGraphInput(testInput.input, testInput.key ?? {}, true);
	}, [testInput?.id]);

	return (
		<Box flexDirection="column">
			<Text bold color="cyan">PLAN: {truncate(localPlan.task, 60)}</Text>
			<Text dimColor>Edges: {edges.length === 0 ? 'none' : edges.map((edge) => `${edge.fromId}->${edge.toId}`).join(', ')}</Text>
			<Box flexDirection="column" marginTop={1}>
				{waves.map((wave, waveIndex) => (
					<Box key={`wave-${waveIndex}`} flexDirection="column" marginBottom={1}>
						<Text color="cyan">
							Wave {waveIndex + 1} {wave.length > 1 ? '(parallel)' : '(sequential)'}
						</Text>
						<Box flexDirection="row">
							{wave.map((step) => {
								const index = localPlan.steps.findIndex((candidate) => candidate.id === step.id);
								const selected = (mode === 'edit' || mode === 'edit-dependencies' || mode === 'edit-prompt') && index === selectedStepIndex;
								return (
									<Box
										key={step.id}
										borderStyle="single"
										borderColor={selected ? 'yellow' : 'gray'}
										flexDirection="column"
										marginRight={1}
										paddingX={1}
										width={28}
									>
										<Text color={selected ? 'yellow' : 'white'}>{truncate(step.agentName, 24)}</Text>
										<Text dimColor>{truncate(step.title, 24)}</Text>
										<Text dimColor>{computeStepSummary(step)}</Text>
									</Box>
								);
							})}
						</Box>
						{waveIndex < waves.length - 1 && (
							<Box flexDirection="row">
								{wave.map((step) => {
									const hasDependent = edges.some((edge) => edge.fromId === step.id);
									return (
										<Box key={`${step.id}-arrow`} width={29} marginRight={1} justifyContent="center">
											<Text dimColor>{hasDependent ? 'v' : ' '}</Text>
										</Box>
									);
								})}
							</Box>
						)}
					</Box>
				))}
			</Box>
			{mode === 'view' && <Text color="green">[y] approve  [e] edit graph  [n] replan</Text>}
			{mode === 'edit' && (
				<Box flexDirection="column">
					<Text color="yellow">Edit step: {selectedStep?.id ?? 'none'}</Text>
					<Text dimColor>Up/down choose | Enter prompt | a agent | d deps | + add | x delete | Esc done</Text>
				</Box>
			)}
			{mode === 'edit-prompt' && (
				<Box>
					<Text color="yellow">Prompt: </Text>
					<TextInput
						focus={interactive}
						value={editValue}
						onChange={(value) => {
							setEditValue(cleanInputValue(value));
						}}
						onSubmit={(value) => {
							saveEdit(cleanInputValue(value));
						}}
					/>
				</Box>
			)}
			{mode === 'edit-dependencies' && (
				<Box>
					<Text color="yellow">Depends on: </Text>
					<TextInput
						focus={interactive}
						value={editValue}
						onChange={(value) => {
							setEditValue(cleanInputValue(value));
						}}
						onSubmit={(value) => {
							saveDependencies(cleanInputValue(value));
						}}
					/>
				</Box>
			)}
			{mode === 'replan' && (
				<Box>
					<Text color="red">Replan reason: </Text>
					<TextInput
						focus={interactive}
						value={replanReason}
						onChange={(value) => {
							setReplanReason(cleanInputValue(value));
						}}
						onSubmit={(value) => {
							onReplan(cleanInputValue(value).trim());
						}}
					/>
				</Box>
			)}
		</Box>
	);
}
