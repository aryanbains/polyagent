import {describe, expect, it} from 'vitest';
import {detectActiveMention, mentionCompletions, parseMentions} from '../src/ui/prompt-completions.js';

const agents = ['researcher', 'writer', 'analyst'];

describe('mention completions', () => {
	it('parses @agent tokens anywhere in the prompt', () => {
		const result = parseMentions('please @researcher review and ask @writer to revise', agents);
		expect(result.sort()).toEqual(['researcher', 'writer']);
	});

	it('ignores unknown @mentions', () => {
		const result = parseMentions('hello @nobody', agents);
		expect(result).toEqual([]);
	});

	it('expands @all to every configured agent', () => {
		const result = parseMentions('ping @all for review', agents);
		expect(result.sort()).toEqual(['analyst', 'researcher', 'writer']);
	});

	it('detects a trailing @token at the cursor', () => {
		const detected = detectActiveMention({value: 'ask @res', cursor: 8, agents});
		expect(detected?.value).toBe('res');
		expect(detected?.start).toBe(4);
		expect(detected?.end).toBe(8);
	});

	it('does not detect a mention in the middle of a word', () => {
		const detected = detectActiveMention({value: 'email@example', cursor: 12, agents});
		expect(detected).toBeNull();
	});

	it('returns multiple completions ordered alphabetically after the @all special', () => {
		const result = mentionCompletions({value: 'ping @', cursor: 6, agents});
		const labels = result.map((completion) => completion.label);
		expect(labels[0]).toBe('@all (every agent)');
		expect(labels).toContain('@analyst');
		expect(labels).toContain('@researcher');
		expect(labels).toContain('@writer');
	});

	it('filters completions by partial token', () => {
		const result = mentionCompletions({value: '@wr', cursor: 3, agents});
		expect(result.map((c) => c.label)).toEqual(['@writer']);
	});
});
