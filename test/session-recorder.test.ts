import {describe, expect, it} from 'vitest';
import {redactSensitiveText, sanitizeRecordedSession, type RecordedSession} from '../src/orchestration/session-recorder.js';

describe('session recorder safety', () => {
	it('redacts common API keys from recorded session text', () => {
		const openRouterKey = ['sk', 'or', 'v1', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
		const openAiKey = ['sk', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
		const text = [
			`OPENROUTER_API_KEY=${openRouterKey}`,
			`OPENAI_API_KEY=${openAiKey}`,
			'{"apiKey":"secret-value"}'
		].join('\n');

		const redacted = redactSensitiveText(text);

		expect(redacted).toContain('OPENROUTER_API_KEY=[REDACTED]');
		expect(redacted).toContain('OPENAI_API_KEY=[REDACTED]');
		expect(redacted).toContain('"apiKey":"[REDACTED]"');
		expect(redacted).not.toContain(openRouterKey);
		expect(redacted).not.toContain('secret-value');
	});

	it('sanitizes session payloads before writing', () => {
		const keyLikeText = ['sk', 'testsecretsecretsecretsecret'].join('-');
		const session: RecordedSession = {
			id: 'session',
			task: `Task with ${keyLikeText}`,
			mode: 'multi-agent',
			createdAt: '2026-01-01T00:00:00.000Z',
			completedAt: '2026-01-01T00:00:01.000Z',
			durationMs: 1000,
			plan: {
				id: 'plan',
				task: 'Task',
				strategy: 'plan_and_execute',
				createdAt: '2026-01-01T00:00:00.000Z',
				source: 'static',
				steps: []
			},
			messages: [],
			executionEvents: [],
			steps: [],
			finalOutput: 'done',
			success: true,
			stats: {
				agentsUsed: 0,
				toolsCalled: 0,
				messages: 0
			}
		};

		const sanitized = sanitizeRecordedSession(session);

		expect(sanitized.task).toContain('[REDACTED_API_KEY]');
	});
});
