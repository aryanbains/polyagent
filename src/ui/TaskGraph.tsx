import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import type {MultiAgentPlan} from '../orchestration/planner.js';
import {computeEdges, computeStepSummary, computeWaves} from '../orchestration/graph.js';

type TaskGraphProps = {
	plan: MultiAgentPlan;
	onApprove: (plan: MultiAgentPlan) => void;
	onEdit: (stepId: string, newPrompt: string) => void;
	onReplan: (reason: string) => void;
	interactive?: boolean;
	testInput?: {
		id: number;
		input: string;
		key?: Partial<GraphKey>;
	};
};

type Mode = 'view' | 'edit' | 'replan';
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

	return `${normalized.slice(0, Math.max(maxLength - 1, 1))}…`;
}

function clonePlan(plan: MultiAgentPlan): MultiAgentPlan {
	return {
		...plan,
		steps: plan.steps.map((step) => ({...step, dependsOn: [...step.dependsOn]}))
	};
}

export function TaskGraph({interactive = true, plan, onApprove, onEdit, onReplan, testInput}: TaskGraphProps): JSX.Element {
	const [mode, setMode] = useState<Mode>('view');
	const [selectedStepIndex, setSelectedStepIndex] = useState(0);
	const [editValue, setEditValue] = useState('');
	const [isEditingPrompt, setIsEditingPrompt] = useState(false);
	const [replanReason, setReplanReason] = useState('');
	const [localPlan, setLocalPlan] = useState<MultiAgentPlan>(() => clonePlan(plan));
	const waves = computeWaves(localPlan.steps);
	const edges = computeEdges(localPlan.steps);
	const selectedStep = localPlan.steps[selectedStepIndex];

	useEffect(() => {
		setLocalPlan(clonePlan(plan));
		setSelectedStepIndex(0);
		setEditValue('');
		setIsEditingPrompt(false);
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
		setIsEditingPrompt(false);
		setMode('view');
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
				setReplanReason((value) => value + input);
			}

			return;
		}

		if (mode === 'edit' && isEditingPrompt) {
			if (fromTest && key.return) {
				saveEdit(editValue);
				return;
			}

			if (key.escape) {
				setIsEditingPrompt(false);
				return;
			}

			if (fromTest && input.length > 0) {
				setEditValue((value) => value + input);
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
				setIsEditingPrompt(true);
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
								const selected = mode === 'edit' && index === selectedStepIndex;
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
											<Text dimColor>{hasDependent ? '↓' : ' '}</Text>
										</Box>
									);
								})}
							</Box>
						)}
					</Box>
				))}
			</Box>
			{mode === 'view' && <Text color="green">[y] approve  [e] edit step  [n] replan</Text>}
			{mode === 'edit' && !isEditingPrompt && (
				<Box flexDirection="column">
					<Text color="yellow">Edit step: {selectedStep?.id ?? 'none'}</Text>
					<Text dimColor>Up/down choose | Enter edit prompt | Esc cancel</Text>
				</Box>
			)}
			{mode === 'edit' && isEditingPrompt && (
				<Box>
					<Text color="yellow">Prompt: </Text>
					<TextInput focus={interactive} value={editValue} onChange={setEditValue} onSubmit={saveEdit} />
				</Box>
			)}
			{mode === 'replan' && (
				<Box>
					<Text color="red">Replan reason: </Text>
					<TextInput
						focus={interactive}
						value={replanReason}
						onChange={setReplanReason}
						onSubmit={(value) => {
							onReplan(value.trim());
						}}
					/>
				</Box>
			)}
		</Box>
	);
}
