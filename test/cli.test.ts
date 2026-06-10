import {describe, expect, it} from 'vitest';
import {buildProgram} from '../src/cli.js';

describe('cli module', () => {
	it('can be imported without executing the program', () => {
		const program = buildProgram();

		expect(program.name()).toBe('polycode');
	});
});
