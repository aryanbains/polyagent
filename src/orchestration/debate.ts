import type {AgentDefinition} from '../agents/schema.js';
import type {LlmClient} from '../chat/run.js';
import type {PolycodeConfig} from '../domain.js';
import type {MultiAgentPlan, MultiAgentPlanStep} from './planner.js';

export type DebateMessage = {
	role: 'advocate' | 'skeptic' | 'judge';
	round: 1 | 2 | 3;
	content: string;
};

export type PlanModification =
	| {
		type: 'modify_prompt' | 'reassign_agent' | 'flag_risk';
		stepId: string;
		value: string;
	}
	| {
		type: 'add_step';
		stepId: string;
		value: MultiAgentPlanStep;
	};

export type DebateOutcome = {
	approved: boolean;
	modifications: PlanModification[];
	summary: string;
	rounds: DebateMessage[];
};

export type DebateOptions = {
	plan: MultiAgentPlan;
	task: string;
	config: PolycodeConfig;
	llmClient: LlmClient;
	agents?: AgentDefinition[];
	callbacks?: {
		onDebateMessage?: (message: DebateMessage) => void;
	};
	maxRounds?: 1 | 2 | 3;
};

const advocatePrompt = 'You are the Advocate in a plan review. Your job is to identify the 3 strongest reasons this execution plan will succeed for the given task. Be specific - reference actual step names, agent assignments, and prompt quality. Output numbered points only.';
const skepticPrompt = 'You are the Skeptic in a plan review. Your job is to find the 2 most dangerous gaps, wrong agent assignments, or underspecified prompts. Do not be constructive - identify the problems only. Output numbered points only.';
const judgePrompt = 'You have read an Advocate defense and a Skeptic critique of this execution plan. Output valid JSON only, no markdown, no commentary. The JSON must have this exact shape: { approved: boolean, summary: string, modifications: [{ type: string, stepId: string, value: string }] }. Use modify_prompt to strengthen a step\'s prompt, reassign_agent to change an agent name, flag_risk to mark a step that needs special care. Only include modifications where the Skeptic raised a valid point that the Advocate did not fully resolve.';

const advocateAgent: AgentDefinition = {
	name: 'advocate',
	role: 'Plan review advocate',
	goal: 'Defend a proposed multi-agent execution plan',
	tools: [],
	memory_enabled: false
};

const skepticAgent: AgentDefinition = {
	name: 'skeptic',
	role: 'Plan review skeptic',
	goal: 'Find dangerous gaps in a proposed multi-agent execution plan',
	tools: [],
	memory_enabled: false
};

const judgeAgent: AgentDefinition = {
	name: 'judge',
	role: 'Plan review judge',
	goal: 'Decide which debate critiques should change the execution plan',
	tools: [],
	memory_enabled: false
};

function formatPlan(plan: MultiAgentPlan): string {
	return plan.steps.map((step, index) => [
		`${index + 1}. ${step.id}: ${step.title}`,
		`Agent: ${step.agentName}`,
		`Depends on: ${step.dependsOn.length === 0 ? 'none' : step.dependsOn.join(', ')}`,
		`Prompt: ${step.prompt}`
	].join('\n')).join('\n\n');
}

function formatTranscript(messages: DebateMessage[]): string {
	return messages.map((message) => `${message.role.toUpperCase()} R${message.round}:\n${message.content}`).join('\n\n');
}

async function collectVirtualAgentOutput(options: {
	config: PolycodeConfig;
	llmClient: LlmClient;
	agent: AgentDefinition;
	system: string;
	content: string;
}): Promise<string> {
	let output = '';

	for await (const token of options.llmClient.streamText({
		config: options.config,
		agent: options.agent,
		system: options.system,
		messages: [{role: 'user', content: options.content}]
	})) {
		output += token;
	}

	return output.trim();
}

function extractJsonObject(value: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(value);
	const raw = fenced?.[1] ?? value;
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');

	if (start === -1 || end === -1 || end <= start) {
		throw new Error('No JSON object found in judge response.');
	}

	return JSON.parse(raw.slice(start, end + 1));
}

function parseModification(value: unknown): PlanModification | null {
	if (typeof value !== 'object' || value === null) {
		return null;
	}

	const candidate = value as Record<string, unknown>;

	if (typeof candidate.type !== 'string' || typeof candidate.stepId !== 'string') {
		return null;
	}

	if (candidate.type === 'modify_prompt' || candidate.type === 'reassign_agent' || candidate.type === 'flag_risk') {
		return typeof candidate.value === 'string'
			? {type: candidate.type, stepId: candidate.stepId, value: candidate.value}
			: null;
	}

	if (candidate.type === 'add_step' && typeof candidate.value === 'object' && candidate.value !== null) {
		const step = candidate.value as Partial<MultiAgentPlanStep>;

		if (
			typeof step.id === 'string'
			&& typeof step.title === 'string'
			&& typeof step.agentName === 'string'
			&& typeof step.prompt === 'string'
		) {
			return {
				type: 'add_step',
				stepId: candidate.stepId,
				value: {
					id: step.id,
					title: step.title,
					agentName: step.agentName,
					prompt: step.prompt,
					dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.filter((item): item is string => typeof item === 'string') : [],
					status: step.status ?? 'pending'
				}
			};
		}
	}

	return null;
}

function parseJudgeOutcome(value: string): Pick<DebateOutcome, 'approved' | 'modifications' | 'summary'> {
	const parsed = extractJsonObject(value) as Record<string, unknown>;
	const rawModifications = Array.isArray(parsed.modifications) ? parsed.modifications : [];
	const modifications = rawModifications
		.map((modification) => parseModification(modification))
		.filter((modification): modification is PlanModification => modification !== null);

	return {
		approved: typeof parsed.approved === 'boolean' ? parsed.approved : modifications.length === 0,
		summary: typeof parsed.summary === 'string' ? parsed.summary : 'Plan review completed.',
		modifications
	};
}

export function applyModifications(
	plan: MultiAgentPlan,
	modifications: PlanModification[],
	agents: AgentDefinition[] = []
): MultiAgentPlan {
	const knownAgents = new Set(agents.map((agent) => agent.name));
	let steps = plan.steps.map((step) => ({...step, dependsOn: [...step.dependsOn]}));

	for (const modification of modifications) {
		if (modification.type === 'add_step') {
			const lastStep = steps.at(-1);
			steps = [
				...steps,
				{
					...modification.value,
					dependsOn: lastStep === undefined ? [] : [lastStep.id],
					status: modification.value.status ?? 'pending'
				}
			];
			continue;
		}

		steps = steps.map((step) => {
			if (step.id !== modification.stepId) {
				return step;
			}

			if (modification.type === 'modify_prompt') {
				return {...step, prompt: modification.value};
			}

			if (modification.type === 'reassign_agent') {
				if (!knownAgents.has(modification.value)) {
					return step;
				}

				return {...step, agentName: modification.value};
			}

			const prompt = step.prompt.startsWith('[HIGH RISK]')
				? step.prompt
				: `[HIGH RISK] ${step.prompt}`;
			return {...step, prompt};
		});
	}

	return {
		...plan,
		steps
	};
}

export async function runAgentDebate(options: DebateOptions): Promise<DebateOutcome> {
	const maxRounds = options.maxRounds ?? 2;
	const planText = formatPlan(options.plan);
	const rounds: DebateMessage[] = [];
	const pushMessage = (message: DebateMessage): void => {
		rounds.push(message);
		options.callbacks?.onDebateMessage?.(message);
	};
	const firstAdvocate = await collectVirtualAgentOutput({
		config: options.config,
		llmClient: options.llmClient,
		agent: advocateAgent,
		system: advocatePrompt,
		content: [`Task:\n${options.task}`, `Execution plan:\n${planText}`].join('\n\n')
	});
	pushMessage({role: 'advocate', round: 1, content: firstAdvocate});

	const firstSkeptic = await collectVirtualAgentOutput({
		config: options.config,
		llmClient: options.llmClient,
		agent: skepticAgent,
		system: skepticPrompt,
		content: [`Task:\n${options.task}`, `Execution plan:\n${planText}`, `Advocate R1:\n${firstAdvocate}`].join('\n\n')
	});
	pushMessage({role: 'skeptic', round: 1, content: firstSkeptic});

	for (let round = 2; round <= maxRounds; round += 1) {
		const advocateResponse = await collectVirtualAgentOutput({
			config: options.config,
			llmClient: options.llmClient,
			agent: advocateAgent,
			system: advocatePrompt,
			content: [
				`Task:\n${options.task}`,
				`Execution plan:\n${planText}`,
				'Prior debate:',
				formatTranscript(rounds),
				'Respond directly to each Skeptic point.'
			].join('\n\n')
		});
		pushMessage({role: 'advocate', round: round as 2 | 3, content: advocateResponse});

		const skepticResponse = await collectVirtualAgentOutput({
			config: options.config,
			llmClient: options.llmClient,
			agent: skepticAgent,
			system: skepticPrompt,
			content: [
				`Task:\n${options.task}`,
				`Execution plan:\n${planText}`,
				'Prior debate:',
				formatTranscript(rounds),
				'Give final objections or acceptance.'
			].join('\n\n')
		});
		pushMessage({role: 'skeptic', round: round as 2 | 3, content: skepticResponse});
	}

	const judgeResponse = await collectVirtualAgentOutput({
		config: options.config,
		llmClient: options.llmClient,
		agent: judgeAgent,
		system: judgePrompt,
		content: [
			`Task:\n${options.task}`,
			`Execution plan:\n${planText}`,
			'Debate transcript:',
			formatTranscript(rounds)
		].join('\n\n')
	});
	const judge = parseJudgeOutcome(judgeResponse);

	return {
		...judge,
		rounds
	};
}
