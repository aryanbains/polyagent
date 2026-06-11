export type TerminalMouseEvent = {
	button: number;
	x: number;
	y: number;
	type: 'press' | 'release' | 'wheel-up' | 'wheel-down' | 'move';
};

const sgrMousePattern = /(?:\u001B\[|\[)?<(\d+);(\d+);(\d+)([mM])/g;

export const enableMouseTrackingSequence = '\u001B[?1000h\u001B[?1006h';
export const disableMouseTrackingSequence = '\u001B[?1000l\u001B[?1002l\u001B[?1003l\u001B[?1006l';

export function parseTerminalMouseEvents(input: string): TerminalMouseEvent[] {
	const events: TerminalMouseEvent[] = [];

	for (const match of input.matchAll(sgrMousePattern)) {
		const button = Number(match[1]);
		const x = Number(match[2]);
		const y = Number(match[3]);
		const suffix = match[4];
		const type = button === 64
			? 'wheel-up'
			: button === 65
				? 'wheel-down'
				: suffix === 'm'
					? 'release'
					: (button & 32) === 32
						? 'move'
						: 'press';

		events.push({button, x, y, type});
	}

	return events;
}

export function stripTerminalMouseSequences(input: string): string {
	return input.replace(sgrMousePattern, '');
}
