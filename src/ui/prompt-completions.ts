/**
 * @-mention parsing and agent completion utilities for the prompt composer.
 *
 * Supports:
 *   - Bare @agent_name tokens inserted anywhere in the prompt.
 *   - Active in-progress mention at the cursor: detect a trailing `@word`
 *     and surface a list of agent names that begin with `word`.
 *   - The literal string `@all` which expands to every configured agent.
 */

export type Completion = {
	value: string;
	label: string;
	start: number;
	end: number;
};

export type CompletionRequest = {
	value: string;
	cursor: number;
	agents: string[];
};

export function parseMentions(value: string, knownAgents: string[]): string[] {
	if (knownAgents.length === 0 || value.length === 0) {
		return [];
	}

	const known = new Set(knownAgents);
	const result = new Set<string>();
	const pattern = /@([A-Za-z0-9_-]+)/g;
	let match: RegExpExecArray | null = pattern.exec(value);

	while (match !== null) {
		const token = match[1] ?? '';
		if (token === 'all') {
			for (const agent of knownAgents) {
				result.add(agent);
			}
		} else if (known.has(token)) {
			result.add(token);
		}
		match = pattern.exec(value);
	}

	return [...result];
}

export function detectActiveMention(request: CompletionRequest): Completion | null {
	const prefix = request.value.slice(0, request.cursor);
	const atIndex = prefix.lastIndexOf('@');

	if (atIndex === -1) {
		return null;
	}

	const before = atIndex === 0 ? ' ' : prefix[atIndex - 1] ?? '';
	if (!/\s/.test(before) && atIndex !== 0) {
		return null;
	}

	const tail = request.value.slice(atIndex + 1, request.cursor);
	if (/\s/.test(tail)) {
		return null;
	}

	return {
		value: tail,
		label: `@${tail}`,
		start: atIndex,
		end: request.cursor
	};
}

export function mentionCompletions(request: CompletionRequest): Completion[] {
	const active = detectActiveMention(request);
	if (active === null) {
		return [];
	}

	const lower = active.value.toLowerCase();
	const candidates: Completion[] = [];

	if ('all'.startsWith(lower) && active.value !== 'all') {
		candidates.push({
			value: 'all',
			label: '@all (every agent)',
			start: active.start,
			end: request.cursor
		});
	}

	for (const name of request.agents) {
		if (name.toLowerCase().startsWith(lower) && name !== active.value) {
			candidates.push({
				value: name,
				label: `@${name}`,
				start: active.start,
				end: request.cursor
			});
		}
	}

	return candidates;
}
