import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {PromptHistory} from '../src/ui/prompt-history.js';

let tmp = '';

beforeEach(async () => {
	tmp = await mkdtemp(path.join(os.tmpdir(), 'polyagent-history-'));
});

afterEach(async () => {
	await rm(tmp, {force: true, recursive: true});
});

describe('PromptHistory', () => {
	it('stores and exposes entries in order', () => {
		const history = new PromptHistory();
		history.push('first');
		history.push('second');
		expect(history.all()).toEqual(['first', 'second']);
	});

	it('does not store empty or duplicate consecutive entries', () => {
		const history = new PromptHistory();
		history.push('');
		history.push('hello');
		history.push('hello');
		history.push('   ');
		expect(history.all()).toEqual(['hello']);
	});

	it('navigates back and forth with up/down', () => {
		const history = new PromptHistory();
		history.push('one');
		history.push('two');
		history.push('three');

		expect(history.previous('draft')).toBe('three');
		expect(history.previous('draft')).toBe('two');
		expect(history.previous('draft')).toBe('one');
		expect(history.previous('draft')).toBe('one');
		expect(history.next()).toBe('two');
		expect(history.next()).toBe('three');
		expect(history.next()).toBe('draft');
	});

	it('keeps the draft when navigating away and back', () => {
		const history = new PromptHistory();
		history.push('a');
		history.push('b');
		expect(history.previous('WIP')).toBe('b');
		expect(history.previous('WIP')).toBe('a');
		expect(history.next()).toBe('b');
		expect(history.next()).toBe('WIP');
	});

	it('caps stored entries at the configured limit', () => {
		const history = new PromptHistory({limit: 3});
		history.push('a');
		history.push('b');
		history.push('c');
		history.push('d');
		expect(history.all()).toEqual(['b', 'c', 'd']);
	});

	it('persists and reloads from disk', async () => {
		const file = path.join(tmp, 'history');
		const history = new PromptHistory();
		history.push('one');
		history.push('two');
		await history.save(file, tmp);

		const reloaded = new PromptHistory();
		await reloaded.loadFromFile(file);
		expect(reloaded.all()).toEqual(['one', 'two']);
	});

	it('appends a single entry to the file', async () => {
		const file = path.join(tmp, 'history');
		const history = new PromptHistory();
		await history.append(file, tmp, 'hello');
		await history.append(file, tmp, 'world');
		const content = await readFile(file, 'utf8');
		expect(content).toBe('hello\nworld\n');
	});
});
