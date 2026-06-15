import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {AgentMessage} from './message-bus.js';
import type {MultiAgentPlan} from './planner.js';
import type {ExecutionEvent} from '../runtime/execution.js';
import type {DebateOutcome} from './debate.js';

export type AgentStepRecord = {
	stepId: string;
	agentName: string;
	title: string;
	status: 'succeeded' | 'failed' | 'skipped';
	output: string;
	error?: string;
	startedAt: string;
	completedAt: string;
	durationMs: number;
};

export type RecordedSession = {
	id: string;
	task: string;
	mode: 'multi-agent';
	createdAt: string;
	completedAt: string;
	durationMs: number;
	plan: MultiAgentPlan;
	debateOutcome?: DebateOutcome;
	messages: AgentMessage[];
	executionEvents: ExecutionEvent[];
	steps: AgentStepRecord[];
	finalOutput: string;
	artifacts?: string[];
	success: boolean;
	stats: {
		agentsUsed: number;
		toolsCalled: number;
		messages: number;
	};
};

export function getSessionsDirectory(workingDirectory: string): string {
	return path.join(workingDirectory, '.polycode', 'sessions');
}

export function createSessionId(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, '-');
}

export async function saveRecordedSession(workingDirectory: string, session: RecordedSession): Promise<string> {
	const directory = getSessionsDirectory(workingDirectory);
	await mkdir(directory, {recursive: true});
	const filePath = path.join(directory, `${session.id}.json`);
	await writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`);
	return filePath;
}

export async function loadRecordedSession(workingDirectory: string, sessionIdOrPath: string): Promise<{filePath: string; session: RecordedSession}> {
	const filePath = path.isAbsolute(sessionIdOrPath) || sessionIdOrPath.endsWith('.json')
		? path.resolve(workingDirectory, sessionIdOrPath)
		: path.join(getSessionsDirectory(workingDirectory), `${sessionIdOrPath}.json`);
	const session = JSON.parse(await readFile(filePath, 'utf8')) as RecordedSession;
	return {filePath, session};
}
