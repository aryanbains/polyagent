/**
 * In-memory prompt history with optional disk persistence.
 *
 * Keeps the last N (default 200) unique entries in memory and (optionally)
 * appends them to `.polyagent/history` so the next session can pick up where
 * the user left off. Strips empty / duplicate entries and supports
 * navigation with `up` / `down` arrows from the prompt composer.
 */

import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_LIMIT = 200;

export class PromptHistory {
	private readonly entries: string[] = [];
	private readonly limit: number;
	private cursor: number | null = null;
	private draft = '';

	constructor(options: {limit?: number; initial?: string[]} = {}) {
		this.limit = Math.max(options.limit ?? DEFAULT_LIMIT, 1);
		if (options.initial !== undefined) {
			for (const entry of options.initial) {
				if (entry.trim().length > 0) {
					this.entries.push(entry);
				}
			}
		}
	}

	get size(): number {
		return this.entries.length;
	}

	get position(): number | null {
		return this.cursor;
	}

	all(): string[] {
		return [...this.entries];
	}

	push(entry: string): boolean {
		const trimmed = entry.trim();

		if (trimmed.length === 0) {
			return false;
		}

		const last = this.entries.at(-1);
		if (last === trimmed) {
			this.resetCursor();
			return false;
		}

		this.entries.push(trimmed);

		while (this.entries.length > this.limit) {
			this.entries.shift();
		}

		this.resetCursor();
		return true;
	}

	resetCursor(): void {
		this.cursor = null;
		this.draft = '';
	}

	/**
	 * Move back one entry. Returns the previous value, or `null` if already at
	 * the start. The first call snapshots the current draft so the user can
	 * return to their in-progress text with `down`.
	 */
	previous(currentDraft: string): string | null {
		if (this.entries.length === 0) {
			return null;
		}

		if (this.cursor === null) {
			this.draft = currentDraft;
			this.cursor = this.entries.length - 1;
			return this.entries[this.cursor]!;
		}

		if (this.cursor <= 0) {
			return this.entries[0] ?? null;
		}

		this.cursor -= 1;
		return this.entries[this.cursor]!;
	}

	next(): string | null {
		if (this.cursor === null) {
			return null;
		}

		if (this.cursor >= this.entries.length - 1) {
			this.cursor = null;
			return this.draft;
		}

		this.cursor += 1;
		return this.entries[this.cursor]!;
	}

	async loadFromFile(filePath: string): Promise<void> {
		try {
			const content = await readFile(filePath, 'utf8');
			for (const line of content.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (trimmed.length > 0) {
					this.entries.push(trimmed);
				}
			}
			while (this.entries.length > this.limit) {
				this.entries.shift();
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}

	async save(filePath: string, workingDirectory: string): Promise<string> {
		const resolved = path.isAbsolute(filePath) ? filePath : path.join(workingDirectory, filePath);
		await mkdir(path.dirname(resolved), {recursive: true});
		await writeFile(resolved, `${this.entries.join('\n')}\n`);
		return resolved;
	}

	async append(filePath: string, workingDirectory: string, entry: string): Promise<string | null> {
		const trimmed = entry.trim();
		if (trimmed.length === 0) {
			return null;
		}

		const resolved = path.isAbsolute(filePath) ? filePath : path.join(workingDirectory, filePath);
		await mkdir(path.dirname(resolved), {recursive: true});
		await appendFile(resolved, `${trimmed}\n`);
		return resolved;
	}
}
