import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {detectActivePath, fileCompletions} from '../src/ui/prompt-files.js';

let root = '';

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), 'polyagent-files-'));
	await writeFile(path.join(root, 'package.json'), '{}');
	await writeFile(path.join(root, 'README.md'), '# hi');
	await mkdir(path.join(root, 'src'));
	await writeFile(path.join(root, 'src', 'index.ts'), '');
	await mkdir(path.join(root, 'src', 'agents'));
	await writeFile(path.join(root, 'src', 'agents', 'run.ts'), '');
});

afterEach(async () => {
	await rm(root, {force: true, recursive: true});
});

describe('file completions', () => {
	it('detects a trailing path token at the cursor', () => {
		const active = detectActivePath({value: 'read ./', cursor: 7, root});
		expect(active?.token).toBe('./');
		expect(active?.start).toBe(5);
	});

	it('does not detect a path inside a normal word', () => {
		const active = detectActivePath({value: 'hello world', cursor: 11, root});
		expect(active).toBeNull();
	});

	it('lists files in the working directory for a bare ./', () => {
		const result = fileCompletions({value: 'read ./', cursor: 7, root});
		const labels = result.map((c) => c.label);
		expect(labels).toContain('package.json');
		expect(labels).toContain('README.md');
	});

	it('drills into a subdirectory', () => {
		const result = fileCompletions({value: 'read ./src/', cursor: 11, root});
		const labels = result.map((c) => c.label);
		expect(labels).toContain('index.ts');
		expect(labels).toContain('agents/');
	});

	it('filters by partial token', () => {
		const result = fileCompletions({value: 'read ./pac', cursor: 10, root});
		expect(result.map((c) => c.label)).toEqual(['package.json']);
	});
});
