import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createEmbedder, FallbackEmbedder, HashEmbedder} from '../src/memory/embedder.js';
import {LocalVectorMemoryStore} from '../src/memory/local-store.js';

let temporaryDirectory = '';

beforeEach(async () => {
	temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'polycode-memory-'));
});

afterEach(async () => {
	await rm(temporaryDirectory, {force: true, recursive: true});
});

describe('LocalVectorMemoryStore', () => {
	it('stores and retrieves similar memories by agent', async () => {
		const store = new LocalVectorMemoryStore(path.join(temporaryDirectory, '.polycode', 'memory.json'), new HashEmbedder());

		await store.add('researcher', 'User asked about TypeScript testing frameworks.');
		await store.add('writer', 'User asked for a landing page draft.');

		const results = await store.search('researcher', 'testing frameworks in TypeScript', 5);
		const stats = await store.stats('researcher');

		expect(results[0]?.record.content).toContain('TypeScript testing');
		expect(stats.totalEmbeddings).toBe(1);
	});

	it('defaults to semantic embeddings with hash fallback', () => {
		const originalMode = process.env.POLYCODE_EMBEDDINGS;
		delete process.env.POLYCODE_EMBEDDINGS;

		try {
			expect(createEmbedder()).toBeInstanceOf(FallbackEmbedder);
		} finally {
			if (originalMode === undefined) {
				delete process.env.POLYCODE_EMBEDDINGS;
			} else {
				process.env.POLYCODE_EMBEDDINGS = originalMode;
			}
		}
	});
});
