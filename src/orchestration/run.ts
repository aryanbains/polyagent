import {randomUUID} from 'node:crypto';
import path from 'node:path';
import PQueue from 'p-queue';
import type {ModelMessage} from 'ai';
import type {AgentDefinition, OrchestratorConfig} from '../agents/schema.js';
import {runAgentTurn, type LlmClient} from '../chat/run.js';
import type {PolycodeConfig} from '../domain.js';
import {
	createExecutionSession,
	type ExecutionEvent
} from '../runtime/execution.js';
import {multiAgentOrchestrator} from '../runtime/orchestration.js';
import {resolveWorkspacePath, writeTextFile} from '../tools/safety.js';
import type {ToolApprovalMode, WebSearchProvider} from '../tools/types.js';
import {createAgentMessageBus, type AgentMessage} from './message-bus.js';
import {createPlannerDescriptor} from './planner.js';
import {type AgentStepRecord, createSessionId, type RecordedSession, saveRecordedSession} from './session-recorder.js';
import {planMultiAgentTask, type MultiAgentPlan, type MultiAgentPlanStep} from './planner.js';

export type AgentRuntimeStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export type MultiAgentRunCallbacks = {
	onPlan?: (plan: MultiAgentPlan) => void;
	onMessage?: (message: AgentMessage) => void;
	onExecutionEvent?: (event: ExecutionEvent) => void;
	onStepStart?: (step: MultiAgentPlanStep) => void;
	onStepFinish?: (record: AgentStepRecord) => void;
	onToken?: (agentName: string, token: string) => void;
	onAgentStatus?: (agentName: string, status: AgentRuntimeStatus) => void;
};

export type MultiAgentRunOptions = {
	config: PolycodeConfig;
	agents: AgentDefinition[];
	orchestrator: OrchestratorConfig;
	task: string;
	approvalMode: ToolApprovalMode;
	webSearchProvider?: WebSearchProvider;
	llmClient?: LlmClient;
	callbacks?: MultiAgentRunCallbacks;
	saveSession?: boolean;
};

export type MultiAgentRunResult = {
	plan: MultiAgentPlan;
	session: RecordedSession;
	sessionPath: string | null;
	finalOutput: string;
	success: boolean;
};

function findAgent(agents: AgentDefinition[], name: string): AgentDefinition {
	return agents.find((agent) => agent.name === name) ?? agents[0]!;
}

function stepContext(step: MultiAgentPlanStep, results: Map<string, AgentStepRecord>): string {
	const dependencies = step.dependsOn
		.map((dependency) => results.get(dependency))
		.filter((record): record is AgentStepRecord => record !== undefined);

	if (dependencies.length === 0) {
		return '';
	}

	return dependencies.map((record) => [
		`Dependency ${record.stepId} from ${record.agentName} (${record.status}):`,
		record.error ?? record.output
	].join('\n')).join('\n\n');
}

function extractMarkdownReportPath(task: string): string | null {
	const match = /(?:at|to|as)\s+([./\\\w-]+\.md)\b/i.exec(task);
	return match?.[1] ?? null;
}

function createMarkdownReport(task: string, records: AgentStepRecord[], finalOutput: string): string {
	return [
		`# ${task}`,
		'',
		'## Summary',
		finalOutput,
		'',
		'## Agent Results',
		...records.map((record) => [
			`### ${record.agentName}: ${record.title}`,
			'',
			`Status: ${record.status}`,
			'',
			record.error ?? record.output
		].join('\n'))
	].join('\n\n');
}

async function maybeWriteRequestedMarkdownReport(options: MultiAgentRunOptions, records: AgentStepRecord[], finalOutput: string): Promise<string | null> {
	const reportPath = extractMarkdownReportPath(options.task);

	if (reportPath === null || options.approvalMode !== 'allow') {
		return null;
	}

	const resolved = resolveWorkspacePath(options.config.project.workingDirectory, reportPath);
	await writeTextFile(resolved, createMarkdownReport(options.task, records, finalOutput));
	return path.relative(options.config.project.workingDirectory, resolved);
}

export async function runMultiAgentTask(options: MultiAgentRunOptions): Promise<MultiAgentRunResult> {
	const startedAt = new Date();
	const sessionId = createSessionId(startedAt);
	const messageBus = createAgentMessageBus();
	const executionEvents: ExecutionEvent[] = [];
	const agentOutputs = new Map<string, ModelMessage[]>();
	const stepRecords = new Map<string, AgentStepRecord>();
	const callbacks = options.callbacks;
	const plan = planMultiAgentTask(options.task, options.agents, options.orchestrator);
	const queue = new PQueue({concurrency: options.orchestrator.max_parallel_agents});

	messageBus.on('message', (message) => {
		callbacks?.onMessage?.(message);
	});
	callbacks?.onPlan?.(plan);

	const executeStep = async (step: MultiAgentPlanStep): Promise<AgentStepRecord> => {
		const agent = findAgent(options.agents, step.agentName);
		const stepStartedAt = new Date();
		callbacks?.onAgentStatus?.(agent.name, 'running');
		callbacks?.onStepStart?.(step);
		messageBus.publish({
			from: 'orchestrator',
			to: agent.name,
			type: 'delegation',
			payload: {
				stepId: step.id,
				title: step.title,
				prompt: step.prompt,
				dependsOn: step.dependsOn
			}
		});

		for (const dependency of step.dependsOn) {
			const dependencyRecord = stepRecords.get(dependency);

			if (dependencyRecord !== undefined) {
				messageBus.publish({
					from: agent.name,
					to: dependencyRecord.agentName,
					type: 'request',
					payload: {
						stepId: step.id,
						dependency,
						request: `Provide the result needed for ${step.title}.`
					}
				});
				messageBus.publish({
					from: dependencyRecord.agentName,
					to: agent.name,
					type: 'response',
					payload: {
						stepId: dependency,
						status: dependencyRecord.status,
						output: dependencyRecord.error ?? dependencyRecord.output
					}
				});
			}
		}

		const dependencyContext = stepContext(step, stepRecords);
		const prompt = [
			`Overall task:\n${options.task}`,
			`Your assigned subtask:\n${step.prompt}`,
			dependencyContext.length > 0 ? `Prior agent context:\n${dependencyContext}` : undefined,
			'Return a concise result that the orchestrator can use.'
		].filter(Boolean).join('\n\n');
		const executionSession = createExecutionSession({
			planner: createPlannerDescriptor(options.orchestrator),
			orchestrator: multiAgentOrchestrator,
			onEvent: (event) => {
				executionEvents.push(event);
				callbacks?.onExecutionEvent?.(event);
			}
		});
		const conversation = agentOutputs.get(agent.name) ?? [];
		agentOutputs.set(agent.name, conversation);
		let output = '';
		let errorMessage: string | undefined;

		try {
			output = await runAgentTurn({
				config: options.config,
				agent,
				message: prompt,
				conversation,
				llmClient: options.llmClient,
				session: executionSession,
				toolContext: {
					workingDirectory: options.config.project.workingDirectory,
					approvalMode: options.approvalMode,
					webSearchProvider: options.webSearchProvider
				},
				onToken: (token) => {
					callbacks?.onToken?.(agent.name, token);
				}
			});
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}

		const completedAt = new Date();
		const record: AgentStepRecord = {
			stepId: step.id,
			agentName: agent.name,
			title: step.title,
			status: errorMessage === undefined ? 'succeeded' : 'failed',
			output,
			error: errorMessage,
			startedAt: stepStartedAt.toISOString(),
			completedAt: completedAt.toISOString(),
			durationMs: completedAt.getTime() - stepStartedAt.getTime()
		};

		stepRecords.set(step.id, record);
		messageBus.publish({
			from: agent.name,
			to: 'orchestrator',
			type: errorMessage === undefined ? 'result' : 'error',
			payload: {
				stepId: step.id,
				status: record.status,
				output: record.error ?? record.output
			}
		});
		callbacks?.onStepFinish?.(record);
		callbacks?.onAgentStatus?.(agent.name, record.status === 'succeeded' ? 'succeeded' : 'failed');
		return record;
	};

	const stepPromises = new Map<string, Promise<AgentStepRecord>>();
	const runWithDependencies = (step: MultiAgentPlanStep): Promise<AgentStepRecord> => {
		const existing = stepPromises.get(step.id);

		if (existing !== undefined) {
			return existing;
		}

		const promise = Promise.all(step.dependsOn.map(async (dependency) => {
			const dependencyStep = plan.steps.find((candidate) => candidate.id === dependency);

			if (dependencyStep !== undefined) {
				await runWithDependencies(dependencyStep);
			}
		})).then(async () => queue.add(async () => executeStep(step)) as Promise<AgentStepRecord>);
		stepPromises.set(step.id, promise);
		return promise;
	};

	const records = await Promise.all(plan.steps.map(async (step) => runWithDependencies(step)));
	const failed = records.filter((record) => record.status === 'failed');
	const finalOutput = [
		failed.length > 0 ? `Completed with ${failed.length} failed step(s).` : 'Completed successfully.',
		...records.map((record) => `${record.agentName}/${record.stepId}: ${record.error ?? record.output}`)
	].join('\n\n');
	const reportPath = await maybeWriteRequestedMarkdownReport(options, records, finalOutput);
	const completedAt = new Date();
	const session: RecordedSession = {
		id: sessionId,
		task: options.task,
		mode: 'multi-agent',
		createdAt: startedAt.toISOString(),
		completedAt: completedAt.toISOString(),
		durationMs: completedAt.getTime() - startedAt.getTime(),
		plan,
		messages: messageBus.history,
		executionEvents,
		steps: records,
		finalOutput: reportPath === null ? finalOutput : `${finalOutput}\n\nWrote ${reportPath}.`,
		success: failed.length === 0,
		stats: {
			agentsUsed: new Set(records.map((record) => record.agentName)).size,
			toolsCalled: executionEvents.filter((event) => event.type === 'tool_started').length,
			messages: messageBus.history.length
		}
	};
	const sessionPath = options.saveSession === false ? null : await saveRecordedSession(options.config.project.workingDirectory, session);

	return {
		plan,
		session,
		sessionPath,
		finalOutput: session.finalOutput,
		success: failed.length === 0
	};
}
