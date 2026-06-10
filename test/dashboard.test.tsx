import React from 'react';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it} from 'vitest';
import {Dashboard} from '../src/ui/Dashboard.js';
import type {PolycodeConfig} from '../src/domain.js';
import type {AgentDefinition} from '../src/agents/schema.js';

const config: PolycodeConfig = {
	version: 1,
	project: {
		name: 'Demo',
		workingDirectory: '/demo'
	},
	llm: {
		provider: 'openai',
		apiKey: null
	},
	memory: {
		backend: 'skip'
	},
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z'
};

const agents: AgentDefinition[] = [
	{
		name: 'researcher',
		role: 'Research specialist',
		goal: 'Find accurate information',
		tools: ['web_search'],
		memory_enabled: true
	}
];

describe('Dashboard', () => {
	afterEach(() => {
		cleanup();
	});

	it('shows first-run guidance when no config exists', () => {
		const {lastFrame} = render(<Dashboard agents={[]} config={null} version="0.1.0" />);

		expect(lastFrame()).toContain('Polycode needs setup');
		expect(lastFrame()).toContain('polycode init');
		expect(lastFrame()).toContain('Config path checked');
		expect(lastFrame()).toContain('Setup needed');
	});

	it('shows agents.yaml guidance when config exists without agents', () => {
		const {lastFrame} = render(<Dashboard agents={[]} config={config} version="0.1.0" />);

		expect(lastFrame()).toContain('No agents.yaml found');
		expect(lastFrame()).toContain('Expected file');
		expect(lastFrame()).toContain('agents.yaml');
		expect(lastFrame()).toContain('Needs attention');
	});

	it('renders the terminal app with configured agents and a prompt composer', () => {
		const {lastFrame} = render(<Dashboard agents={agents} config={config} memoryStats={{
			backend: 'local',
			totalEmbeddings: 2,
			lastAccessedAt: '2026-01-01T00:00:00.000Z',
			status: 'ready'
		}} version="0.1.0" />);

		expect(lastFrame()).toContain('Polycode v0.1.0');
		expect(lastFrame()).toContain('Agents');
		expect(lastFrame()).toContain('researcher idle');
		expect(lastFrame()).toContain('/help for commands');
		expect(lastFrame()).toContain('Ask researcher to');
	});
});
