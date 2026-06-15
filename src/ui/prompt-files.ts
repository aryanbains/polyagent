/**
 * File-path completion utilities for the prompt composer.
 *
 * Detects an in-progress path token (a whitespace-delimited word that looks
 * like a file path) and suggests files from a known root directory.
 */

import {existsSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';

export type FileCompletion = {
	value: string;
	label: string;
	start: number;
	end: number;
	kind: 'file' | 'directory';
};

export type FileCompletionRequest = {
	value: string;
	cursor: number;
	root: string;
	limit?: number;
};

const PATH_LIKE = /[./~]/;

export function detectActivePath(request: FileCompletionRequest): {prefix: string; token: string; start: number} | null {
	const head = request.value.slice(0, request.cursor);
	const match = /(^|\s)([^\s]*)$/.exec(head);

	if (match === null) {
		return null;
	}

	const token = match[2] ?? '';
	if (token.length === 0) {
		return null;
	}

	if (!PATH_LIKE.test(token)) {
		return null;
	}

	const start = (match.index ?? 0) + (match[1]?.length ?? 0);
	return {prefix: head.slice(0, start), token, start};
}

function expandHome(token: string): string {
	if (token === '~') {
		return process.env.HOME ?? process.env.USERPROFILE ?? token;
	}

	if (token.startsWith('~/') || token.startsWith('~\\')) {
		const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
		return home.length > 0 ? home + token.slice(1) : token;
	}

	return token;
}

export function fileCompletions(request: FileCompletionRequest): FileCompletion[] {
	const active = detectActivePath(request);
	if (active === null) {
		return [];
	}

	const expanded = expandHome(active.token);
	const isAbsolute = path.isAbsolute(expanded);
	const hasTrailingSeparator = /[\\/]$/.test(expanded);
	const dirPart = hasTrailingSeparator ? expanded : path.dirname(expanded);
	const partial = hasTrailingSeparator ? '' : path.basename(expanded);
	const root = isAbsolute ? dirPart : path.resolve(request.root, dirPart);

	if (!existsSync(root)) {
		return [];
	}

	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return [];
	}

	const limit = request.limit ?? 12;
	const matches: FileCompletion[] = [];

	for (const entry of entries) {
		if (!entry.toLowerCase().startsWith(partial.toLowerCase())) {
			continue;
		}

		const absolute = path.join(root, entry);
		let isDir = false;
		try {
			isDir = statSync(absolute).isDirectory();
		} catch {
			continue;
		}

		const relativeToRoot = path.relative(request.root, absolute).split(path.sep).join('/');
		const relativeToToken = isAbsolute
			? absolute
			: relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)
				? absolute
				: relativeToRoot;

		matches.push({
			value: isDir ? `${relativeToToken}/` : relativeToToken,
			label: isDir ? `${entry}/` : entry,
			start: active.start,
			end: request.cursor,
			kind: isDir ? 'directory' : 'file'
		});

		if (matches.length >= limit) {
			break;
		}
	}

	return matches;
}
