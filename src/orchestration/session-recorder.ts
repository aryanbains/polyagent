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
	status: 'succeeded' | 'failed' | 'skipped' | 'cancelled';
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
	cancelled?: boolean;
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

export function redactSensitiveText(value: string, maxLength = 12_000): string {
	const redacted = value
		.replace(/\bsk-or-v1-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_OPENROUTER_KEY]')
		.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]')
		.replace(/\b(OPENAI|ANTHROPIC|GROQ|OPENROUTER|TAVILY)_API_KEY\s*=\s*["']?[^"'\s]+/gi, '$1_API_KEY=[REDACTED]')
		.replace(/("apiKey"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED]$3')
		.replace(/(api[_-]?key\s*[:=]\s*)[^\s,;}]+/gi, '$1[REDACTED]');

	return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}\n[session text truncated]`;
}

function sanitizeValue(value: unknown, maxStringLength = 12_000): unknown {
	if (typeof value === 'string') {
		return redactSensitiveText(value, maxStringLength);
	}

	if (value instanceof Date) {
		return value.toISOString();
	}

	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item, Math.min(maxStringLength, 4000)));
	}

	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [
			key,
			/key|token|secret|password/i.test(key) ? '[REDACTED]' : sanitizeValue(item, Math.min(maxStringLength, 4000))
		]));
	}

	return value;
}

export function sanitizeRecordedSession(session: RecordedSession): RecordedSession {
	return sanitizeValue(session) as RecordedSession;
}

export async function saveRecordedSession(workingDirectory: string, session: RecordedSession): Promise<string> {
	const directory = getSessionsDirectory(workingDirectory);
	await mkdir(directory, {recursive: true});
	const filePath = path.join(directory, `${session.id}.json`);
	await writeFile(filePath, `${JSON.stringify(sanitizeRecordedSession(session), null, 2)}\n`);
	return filePath;
}

export async function loadRecordedSession(workingDirectory: string, sessionIdOrPath: string): Promise<{filePath: string; session: RecordedSession}> {
	const filePath = path.isAbsolute(sessionIdOrPath) || sessionIdOrPath.endsWith('.json')
		? path.resolve(workingDirectory, sessionIdOrPath)
		: path.join(getSessionsDirectory(workingDirectory), `${sessionIdOrPath}.json`);
	const session = JSON.parse(await readFile(filePath, 'utf8')) as RecordedSession;
	return {filePath, session};
}
