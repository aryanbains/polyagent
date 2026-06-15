import {describe, expect, it} from 'vitest';
import type {AgentDefinition, OrchestratorConfig} from '../src/agents/schema.js';
import {planMultiAgentTask, planReActTask} from '../src/orchestration/planner.js';

const agents: AgentDefinition[] = [
	{name: 'helper', role: 'Personal assistant', goal: 'Help the user', tools: [], memory_enabled: false},
	{name: 'researcher', role: 'Research specialist', goal: 'Find facts', tools: [], memory_enabled: false},
	{name: 'writer', role: 'Writer', goal: 'Write output', tools: [], memory_enabled: false}
];

const orchestrator: OrchestratorConfig = {
	strategy: 'react',
	max_parallel_agents: 1,
	max_iterations: 10
};

describe('react strategy', () => {
	it('planReActTask returns a single-step plan', () => {
		const plan = planReActTask('summarize the docs', agents, orchestrator);

		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0]?.id).toBe('react');
		expect(plan.strategy).toBe('react');
		expect(plan.source).toBe('static');
	});

	it('react step prompt mentions reasoning and acting', () => {
		const plan = planReActTask('read package.json', agents, orchestrator);

		expect(plan.steps[0]?.prompt.toLowerCase()).toContain('reason');
		expect(plan.steps[0]?.prompt.toLowerCase()).toContain('act');
		expect(plan.steps[0]?.prompt).toContain('read package.json');
	});

	it('react prompt lists available specialists when more than one agent is configured', () => {
		const plan = planReActTask('do the thing', agents, orchestrator);

		expect(plan.steps[0]?.prompt).toContain('message_agent');
		expect(plan.steps[0]?.prompt).toContain('researcher');
		expect(plan.steps[0]?.prompt).toContain('writer');
	});

	it('react plan has no dependencies', () => {
		const plan = planReActTask('do the thing', agents, orchestrator);

		expect(plan.steps[0]?.dependsOn).toEqual([]);
	});

	it('planMultiAgentTask dispatches to planReActTask when strategy is react', () => {
		const plan = planMultiAgentTask('hello', agents, orchestrator);

		expect(plan.strategy).toBe('react');
		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0]?.id).toBe('react');
	});

	it('react works with a single agent and skips the specialist hint', () => {
		const solo: AgentDefinition[] = [
			{name: 'helper', role: 'Personal assistant', goal: 'Help the user', tools: [], memory_enabled: false}
		];
		const plan = planReActTask('do it', solo, orchestrator);

		expect(plan.steps[0]?.prompt).not.toContain('message_agent');
		expect(plan.steps[0]?.prompt).toContain('do it');
	});
});
