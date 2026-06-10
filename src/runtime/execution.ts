import {randomUUID} from 'node:crypto';
import {singleAgentOrchestrator, singleAgentPlanner, type OrchestratorDescriptor, type PlannerDescriptor} from './orchestration.js';

export type ExecutionStatus = 'started' | 'succeeded' | 'failed';

export type ExecutionTokenCounts = {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
};

type ExecutionEventBase = {
	sessionId: string;
	runId: string;
	stepId: string;
	agentName: string;
	timestamp: string;
};

export type RunStartedEvent = ExecutionEventBase & {
	type: 'run_started';
	status: 'started';
	inputSummary: string;
	planner: PlannerDescriptor;
	orchestrator: OrchestratorDescriptor;
};

export type RunFinishedEvent = ExecutionEventBase & {
	type: 'run_finished';
	status: 'succeeded' | 'failed';
	success: boolean;
	startedAt: string;
	completedAt: string;
	durationMs: number;
	outputSummary: string;
	tokenCounts?: ExecutionTokenCounts;
};

export type ToolStartedEvent = ExecutionEventBase & {
	type: 'tool_started';
	status: 'started';
	toolCallId: string;
	toolName: string;
	input: unknown;
	startedAt: string;
};

export type ToolFinishedEvent = ExecutionEventBase & {
	type: 'tool_finished';
	status: 'succeeded' | 'failed';
	toolCallId: string;
	toolName: string;
	input: unknown;
	outputSummary: string;
	success: boolean;
	startedAt: string;
	completedAt: string;
	durationMs: number;
};

export type ExecutionEvent = RunStartedEvent | RunFinishedEvent | ToolStartedEvent | ToolFinishedEvent;

export type ExecutionSessionOptions = {
	id?: string;
	planner?: PlannerDescriptor;
	orchestrator?: OrchestratorDescriptor;
	onEvent?: (event: ExecutionEvent) => void;
};

type RunningTool = {
	stepId: string;
	toolCallId: string;
	toolName: string;
	input: unknown;
	startedAt: string;
	startedAtMs: number;
};

export type RunningToolExecution = RunningTool;

export class ExecutionSession {
	readonly id: string;
	readonly planner: PlannerDescriptor;
	readonly orchestrator: OrchestratorDescriptor;
	readonly events: ExecutionEvent[] = [];
	private stepCounter = 0;
	private readonly onEvent?: (event: ExecutionEvent) => void;

	constructor(options: ExecutionSessionOptions = {}) {
		this.id = options.id ?? randomUUID();
		this.planner = options.planner ?? singleAgentPlanner;
		this.orchestrator = options.orchestrator ?? singleAgentOrchestrator;
		this.onEvent = options.onEvent;
	}

	nextStepId(): string {
		this.stepCounter += 1;
		return `step-${this.stepCounter}`;
	}

	emit(event: ExecutionEvent): void {
		this.events.push(event);
		this.onEvent?.(event);
	}
}

export function createExecutionSession(options: ExecutionSessionOptions = {}): ExecutionSession {
	return new ExecutionSession(options);
}

export function summarizeExecutionValue(value: unknown, maxLength = 220): string {
	const raw = typeof value === 'string' ? value : JSON.stringify(value);
	const summary = raw === undefined ? String(value) : raw;
	return summary.length > maxLength ? `${summary.slice(0, maxLength)}...` : summary;
}

export function createRunStartedEvent(session: ExecutionSession, runId: string, stepId: string, agentName: string, input: string): RunStartedEvent {
	const timestamp = new Date().toISOString();
	return {
		type: 'run_started',
		sessionId: session.id,
		runId,
		stepId,
		agentName,
		timestamp,
		status: 'started',
		inputSummary: summarizeExecutionValue(input),
		planner: session.planner,
		orchestrator: session.orchestrator
	};
}

export function createRunFinishedEvent(
	session: ExecutionSession,
	runId: string,
	stepId: string,
	agentName: string,
	startedAt: string,
	startedAtMs: number,
	success: boolean,
	output: string,
	tokenCounts?: ExecutionTokenCounts
): RunFinishedEvent {
	const completedAt = new Date().toISOString();
	return {
		type: 'run_finished',
		sessionId: session.id,
		runId,
		stepId,
		agentName,
		timestamp: completedAt,
		status: success ? 'succeeded' : 'failed',
		success,
		startedAt,
		completedAt,
		durationMs: Date.now() - startedAtMs,
		outputSummary: summarizeExecutionValue(output),
		tokenCounts
	};
}

export function createToolStartedEvent(session: ExecutionSession, runId: string, agentName: string, toolCallId: string, toolName: string, input: unknown): {event: ToolStartedEvent; runningTool: RunningToolExecution} {
	const startedAt = new Date().toISOString();
	const startedAtMs = Date.now();
	const stepId = session.nextStepId();

	const event: ToolStartedEvent = {
		type: 'tool_started',
		sessionId: session.id,
		runId,
		stepId,
		agentName,
		timestamp: startedAt,
		status: 'started',
		toolCallId,
		toolName,
		input,
		startedAt
	};

	return {
		event,
		runningTool: {
			stepId,
			toolCallId,
			toolName,
			input,
			startedAt,
			startedAtMs
		}
	};
}

export function createToolFinishedEvent(session: ExecutionSession, runId: string, agentName: string, runningTool: RunningToolExecution, output: unknown, success: boolean): ToolFinishedEvent {
	const completedAt = new Date().toISOString();
	return {
		type: 'tool_finished',
		sessionId: session.id,
		runId,
		stepId: runningTool.stepId,
		agentName,
		timestamp: completedAt,
		status: success ? 'succeeded' : 'failed',
		toolCallId: runningTool.toolCallId,
		toolName: runningTool.toolName,
		input: runningTool.input,
		outputSummary: summarizeExecutionValue(output),
		success,
		startedAt: runningTool.startedAt,
		completedAt,
		durationMs: Date.now() - runningTool.startedAtMs
	};
}
