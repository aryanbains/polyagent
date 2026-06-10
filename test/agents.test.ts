import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {loadAgents} from '../src/agents/load.js';

let temporaryDirectory = '';

beforeEach(async () => {
	temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'polycode-agents-'));
});

afterEach(async () => {
	await rm(temporaryDirectory, {force: true, recursive: true});
});

describe('loadAgents', () => {
	it('loads valid agents.yaml files', async () => {
		await writeFile(path.join(temporaryDirectory, 'agents.yaml'), [
			'orchestrator:',
			'  strategy: plan_and_execute',
			'  max_parallel_agents: 2',
			'  max_iterations: 5',
			'agents:',
			'  - name: researcher',
			'    role: Research specialist',
			'    goal: Find accurate information',
			'    tools: [web_search, file_read]'
		].join('\n'));

		const result = await loadAgents({workingDirectory: temporaryDirectory, requireFile: true});

		expect(result.agents).toHaveLength(1);
		expect(result.agents[0]?.name).toBe('researcher');
		expect(result.agents[0]?.memory_enabled).toBe(true);
		expect(result.orchestrator).toEqual({
			strategy: 'plan_and_execute',
			max_parallel_agents: 2,
			max_iterations: 5
		});
	});

	it('fails invalid schemas with readable paths', async () => {
		await writeFile(path.join(temporaryDirectory, 'agents.yaml'), [
			'agents:',
			'  - name: bad agent',
			'    goal: Missing role'
		].join('\n'));

		await expect(loadAgents({workingDirectory: temporaryDirectory, requireFile: true})).rejects.toThrow('agents.0.role');
	});
});
