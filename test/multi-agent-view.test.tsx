import React from 'react';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it} from 'vitest';
import {MultiAgentSessionView} from '../src/ui/MultiAgentSessionView.js';
import type {RecordedSession} from '../src/orchestration/session-recorder.js';

const session: RecordedSession = {
	id: 'demo',
	task: 'Research testing frameworks and write a report',
	mode: 'multi-agent',
	createdAt: '2026-01-01T00:00:00.000Z',
	completedAt: '2026-01-01T00:00:01.000Z',
	durationMs: 1000,
	success: true,
	finalOutput: 'done',
	plan: {
		id: 'plan',
		task: 'Research testing frameworks and write a report',
		strategy: 'plan_and_execute',
		createdAt: '2026-01-01T00:00:00.000Z',
		source: 'static',
		steps: [
			{id: 'research', title: 'Research', agentName: 'researcher', prompt: 'Research', dependsOn: [], status: 'pending'},
			{id: 'analysis', title: 'Analyze', agentName: 'analyst', prompt: 'Analyze', dependsOn: [], status: 'pending'},
			{id: 'synthesis', title: 'Write', agentName: 'writer', prompt: 'Write', dependsOn: ['research', 'analysis'], status: 'pending'}
		]
	},
	messages: [
		{id: '1', from: 'orchestrator', to: 'researcher', type: 'delegation', payload: {}, timestamp: new Date('2026-01-01T00:00:00.000Z')},
		{id: '2', from: 'writer', to: 'researcher', type: 'request', payload: {}, timestamp: new Date('2026-01-01T00:00:00.100Z')},
		{id: '3', from: 'researcher', to: 'writer', type: 'response', payload: {}, timestamp: new Date('2026-01-01T00:00:00.200Z')}
	],
	executionEvents: [],
	steps: [
		{stepId: 'research', agentName: 'researcher', title: 'Research', status: 'succeeded', output: 'research done', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.300Z', durationMs: 300},
		{stepId: 'analysis', agentName: 'analyst', title: 'Analyze', status: 'succeeded', output: 'analysis done', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.400Z', durationMs: 400},
		{stepId: 'synthesis', agentName: 'writer', title: 'Write', status: 'succeeded', output: 'writer done', startedAt: '2026-01-01T00:00:00.400Z', completedAt: '2026-01-01T00:00:01.000Z', durationMs: 600}
	],
	stats: {
		agentsUsed: 3,
		toolsCalled: 2,
		messages: 3
	}
};

function makeStressSession(messageCount: number): RecordedSession {
	return {
		...session,
		id: `stress-${messageCount}`,
		task: 'Run three agents with concurrent streaming output and a very long task title that should stay inside the terminal layout',
		messages: Array.from({length: messageCount}, (_, index) => ({
			id: `message-${index}`,
			from: index % 3 === 0 ? 'researcher' : index % 3 === 1 ? 'analyst' : 'writer',
			to: index % 2 === 0 ? 'orchestrator' : 'broadcast',
			type: index % 5 === 0 ? 'request' : index % 5 === 1 ? 'response' : 'status',
			payload: {
				text: `message payload ${index}`
			},
			timestamp: new Date(`2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`)
		})),
		steps: session.steps.map((step, index) => ({
			...step,
			output: `${step.output} ${'streamed output chunk '.repeat(30 + index * 10)}`
		})),
		stats: {
			agentsUsed: 3,
			toolsCalled: 12,
			messages: messageCount
		}
	};
}

describe('MultiAgentSessionView', () => {
	afterEach(() => {
		cleanup();
	});

	it('keeps the three-agent terminal layout readable', () => {
		const {lastFrame} = render(<MultiAgentSessionView interactive={false} session={session} version="0.1.0" />);

		expect(lastFrame()).toContain('Multi-agent 3/3');
		expect(lastFrame()).toContain('researcher succeeded');
		expect(lastFrame()).toContain('analyst succeeded');
		expect(lastFrame()).toContain('writer succeeded');
		expect(lastFrame()).toContain('Messages');
		expect(lastFrame()).toContain('agents 3');
	});

	it('survives stress rerenders with dense three-agent message traffic', () => {
		const {lastFrame, rerender} = render(<MultiAgentSessionView interactive={false} session={makeStressSession(10)} version="0.1.0" />);

		for (const messageCount of [20, 40, 60, 90]) {
			rerender(<MultiAgentSessionView interactive={false} session={makeStressSession(messageCount)} version="0.1.0" />);
		}

		const frame = lastFrame() ?? '';
		const longestLine = Math.max(...frame.split('\n').map((line) => line.length));

		expect(frame).toContain('Multi-agent 3/3');
		expect(frame).toContain('Messages');
		expect(frame).toContain('agents 3 | tools 12 | messages 90');
		expect(frame).not.toContain('ERROR');
		expect(longestLine).toBeLessThanOrEqual(140);
	});
});
