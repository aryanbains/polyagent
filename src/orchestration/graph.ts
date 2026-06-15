import type {MultiAgentPlanStep} from './planner.js';

export function computeWaves(steps: MultiAgentPlanStep[]): MultiAgentPlanStep[][] {
	const remaining = [...steps];
	const knownIds = new Set(steps.map((step) => step.id));
	const completed = new Set<string>();
	const waves: MultiAgentPlanStep[][] = [];

	while (remaining.length > 0) {
		const wave = remaining.filter((step) => {
			return step.dependsOn.every((dependency) => !knownIds.has(dependency) || completed.has(dependency));
		});

		if (wave.length === 0) {
			waves.push([...remaining]);
			break;
		}

		waves.push(wave);

		for (const step of wave) {
			completed.add(step.id);
		}

		const waveIds = new Set(wave.map((step) => step.id));

		for (let index = remaining.length - 1; index >= 0; index -= 1) {
			if (waveIds.has(remaining[index]!.id)) {
				remaining.splice(index, 1);
			}
		}
	}

	return waves;
}

export function computeStepSummary(step: MultiAgentPlanStep): string {
	const normalized = step.prompt.replace(/\s+/g, ' ').trim();

	if (normalized.length <= 50) {
		return normalized;
	}

	return `${normalized.slice(0, 49)}…`;
}

export function computeEdges(steps: MultiAgentPlanStep[]): Array<{fromId: string; toId: string}> {
	return steps.flatMap((step) => step.dependsOn.map((dependency) => ({
		fromId: dependency,
		toId: step.id
	})));
}
