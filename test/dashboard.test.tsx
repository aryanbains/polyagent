import React from 'react';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it} from 'vitest';
import {Dashboard} from '../src/ui/Dashboard.js';
import type {PolycodeConfig} from '../src/domain.js';

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

describe('Dashboard', () => {
	afterEach(() => {
		cleanup();
	});

	it('renders the Phase 1 terminal shell', () => {
		const {lastFrame} = render(<Dashboard config={config} version="0.1.0" />);

		expect(lastFrame()).toContain('Polycode v0.1.0');
		expect(lastFrame()).toContain('Agents');
		expect(lastFrame()).toContain('No agents configured');
		expect(lastFrame()).toContain('q quit');
	});
});
