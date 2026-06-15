import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {buildProgram, isDirectExecution} from '../src/cli.js';

describe('cli module', () => {
	it('can be imported without executing the program', () => {
		const program = buildProgram();

		expect(program.name()).toBe('polyagent');
	});

	it('detects direct execution through resolved file paths', () => {
		const cliPath = new URL('../src/cli.tsx', import.meta.url);

		expect(isDirectExecution(fileURLToPath(cliPath), cliPath.href)).toBe(true);
		expect(isDirectExecution(undefined, cliPath.href)).toBe(false);
	});
});
