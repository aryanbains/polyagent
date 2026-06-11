import {describe, expect, it} from 'vitest';
import {parseTerminalMouseEvents, stripTerminalMouseSequences} from '../src/ui/mouse.js';

describe('terminal mouse parsing', () => {
	it('parses SGR mouse clicks and wheel events', () => {
		expect(parseTerminalMouseEvents('\u001B[<0;12;5M')).toEqual([
			{button: 0, x: 12, y: 5, type: 'press'}
		]);
		expect(parseTerminalMouseEvents('\u001B[<64;40;10M')).toEqual([
			{button: 64, x: 40, y: 10, type: 'wheel-up'}
		]);
		expect(parseTerminalMouseEvents('\u001B[<65;40;10M')).toEqual([
			{button: 65, x: 40, y: 10, type: 'wheel-down'}
		]);
		expect(parseTerminalMouseEvents('[<65;69;20M')).toEqual([
			{button: 65, x: 69, y: 20, type: 'wheel-down'}
		]);
		expect(parseTerminalMouseEvents('<0;61;15M')).toEqual([
			{button: 0, x: 61, y: 15, type: 'press'}
		]);
	});

	it('strips mouse escape sequences from prompt text', () => {
		expect(stripTerminalMouseSequences('search\u001B[<0;12;5M this')).toBe('search this');
		expect(stripTerminalMouseSequences('[<65;69;20M[<64;69;20M')).toBe('');
		expect(stripTerminalMouseSequences('<65;69;20M<0;61;15Mhello')).toBe('hello');
	});
});
