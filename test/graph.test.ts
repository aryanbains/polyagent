import {describe, expect, it} from 'vitest';
import {computeEdges, computeStepSummary, computeWaves} from '../src/orchestration/graph.js';
import type {MultiAgentPlanStep} from '../src/orchestration/planner.js';

function step(id: string, dependsOn: string[] = [], prompt = `Prompt for ${id}`): MultiAgentPlanStep {
	return {
		id,
		title: `Step ${id}`,
		agentName: `agent-${id}`,
		prompt,
		dependsOn,
		status: 'pending'
	};
}

describe('task graph utilities', () => {
	it('places three independent steps in one wave', () => {
		expect(computeWaves([step('a'), step('b'), step('c')]).map((wave) => wave.map((item) => item.id))).toEqual([['a', 'b', 'c']]);
	});

	it('places A to B to C in three sequential waves', () => {
		expect(computeWaves([step('a'), step('b', ['a']), step('c', ['b'])]).map((wave) => wave.map((item) => item.id))).toEqual([['a'], ['b'], ['c']]);
	});

	it('places A and B before C when C depends on both', () => {
		expect(computeWaves([step('a'), step('b'), step('c', ['a', 'b'])]).map((wave) => wave.map((item) => item.id))).toEqual([['a', 'b'], ['c']]);
	});

	it('handles a single step', () => {
		expect(computeWaves([step('a')]).map((wave) => wave.map((item) => item.id))).toEqual([['a']]);
	});

	it('does not throw when a dependency is nonexistent', () => {
		expect(computeWaves([step('a', ['missing'])]).map((wave) => wave.map((item) => item.id))).toEqual([['a']]);
	});

	it('truncates long prompts with an ellipsis', () => {
		const summary = computeStepSummary(step('a', [], 'x'.repeat(80)));

		expect(summary).toHaveLength(50);
		expect(summary.endsWith('…')).toBe(true);
	});

	it('leaves short prompts unchanged', () => {
		expect(computeStepSummary(step('a', [], 'Short prompt'))).toBe('Short prompt');
	});

	it('returns one edge per dependency', () => {
		expect(computeEdges([step('a'), step('b', ['a']), step('c', ['a', 'b'])])).toEqual([
			{fromId: 'a', toId: 'b'},
			{fromId: 'a', toId: 'c'},
			{fromId: 'b', toId: 'c'}
		]);
	});

	it('returns no edges for independent steps', () => {
		expect(computeEdges([step('a'), step('b')])).toEqual([]);
	});
});
