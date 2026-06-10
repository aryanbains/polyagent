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

describe('MultiAgentSessionView', () => {
	afterEach(() => {
		cleanup();
	});

	it('keeps the three-agent terminal layout readable', () => {
		const {lastFrame} = render(<MultiAgentSessionView session={session} version="0.1.0" />);

		expect(lastFrame()).toContain('Multi-agent 3/3');
		expect(lastFrame()).toContain('researcher succeeded');
		expect(lastFrame()).toContain('analyst succeeded');
		expect(lastFrame()).toContain('writer succeeded');
		expect(lastFrame()).toContain('Messages');
		expect(lastFrame()).toContain('agents 3');
	});
});
