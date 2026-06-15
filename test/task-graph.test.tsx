import React from 'react';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {MultiAgentPlan} from '../src/orchestration/planner.js';
import {TaskGraph} from '../src/ui/TaskGraph.js';

const waitForInk = async (): Promise<void> => new Promise((resolve) => {
	setTimeout(resolve, 20);
});

type TestInput = React.ComponentProps<typeof TaskGraph>['testInput'];
type TestKey = NonNullable<TestInput>['key'];

function renderGraph(options: {
	onApprove?: (plan: MultiAgentPlan) => void;
	onEdit?: (stepId: string, prompt: string) => void;
	onReplan?: (reason: string) => void;
} = {}) {
	let eventId = 0;
	let testInput: TestInput | undefined;
	const props = {
		plan: plan(),
		onApprove: options.onApprove ?? (() => {}),
		onEdit: options.onEdit ?? (() => {}),
		onReplan: options.onReplan ?? (() => {}),
		interactive: false
	};
	const instance = render(<TaskGraph {...props} testInput={testInput} />);
	const send = async (input: string, key: TestKey = {}): Promise<void> => {
		eventId += 1;
		testInput = {id: eventId, input, key};
		instance.rerender(<TaskGraph {...props} testInput={testInput} />);
		await waitForInk();
	};

	return {...instance, send};
}

function plan(): MultiAgentPlan {
	return {
		id: 'plan',
		task: 'Research, analyze, and write a report',
		strategy: 'plan_and_execute',
		createdAt: '2026-01-01T00:00:00.000Z',
		source: 'static',
		steps: [
			{
				id: 'research',
				title: 'Research source material',
				agentName: 'researcher',
				prompt: 'Original research prompt',
				dependsOn: [],
				status: 'pending'
			},
			{
				id: 'write',
				title: 'Write final report',
				agentName: 'writer',
				prompt: 'Original writer prompt',
				dependsOn: ['research'],
				status: 'pending'
			}
		]
	};
}

describe('TaskGraph', () => {
	afterEach(() => {
		cleanup();
	});

	it('renders the plan title', () => {
		const {lastFrame} = renderGraph();

		expect(lastFrame()).toContain('PLAN: Research, analyze, and write a report');
	});

	it('renders all agent names', () => {
		const {lastFrame} = renderGraph();

		expect(lastFrame()).toContain('researcher');
		expect(lastFrame()).toContain('writer');
	});

	it('fires onApprove with the plan when y is pressed', async () => {
		const onApprove = vi.fn();
		const {send} = renderGraph({onApprove});

		await send('y');

		expect(onApprove).toHaveBeenCalledOnce();
		expect(onApprove.mock.calls[0]?.[0].steps).toHaveLength(2);
	});

	it('fires onEdit with the selected step and new prompt', async () => {
		const onEdit = vi.fn();
		const {send} = renderGraph({onEdit});

		await send('e');
		await send('', {return: true});
		await send(' plus details');
		await send('', {return: true});

		expect(onEdit).toHaveBeenCalledWith('research', 'Original research prompt plus details');
	});

	it('fires onReplan with the typed reason', async () => {
		const onReplan = vi.fn();
		const {send} = renderGraph({onReplan});

		await send('n');
		await send('Need a safer approach');
		await send('', {return: true});

		expect(onReplan).toHaveBeenCalledWith('Need a safer approach');
	});

	it('changes the selected step with arrow keys in edit mode', async () => {
		const {lastFrame, send} = renderGraph();

		await send('e');
		await send('', {downArrow: true});

		expect(lastFrame()).toContain('Edit step: write');
	});

	it('passes edited prompts through onApprove', async () => {
		const onApprove = vi.fn();
		const {send} = renderGraph({onApprove});

		await send('e');
		await send('', {return: true});
		await send(' with sources');
		await send('', {return: true});
		await send('y');

		const approved = onApprove.mock.calls[0]?.[0] as MultiAgentPlan;
		expect(approved.steps.find((step) => step.id === 'research')?.prompt).toBe('Original research prompt with sources');
	});
});
