import type {PolycodeConfig} from '../domain.js';
import {ChromaMemoryStore} from './chroma-store.js';
import {LocalVectorMemoryStore} from './local-store.js';
import {NullMemoryStore} from './null-store.js';
import type {MemoryStats, MemoryStore} from './types.js';

export class UnsupportedMemoryBackendError extends Error {
	constructor(backend: string) {
		super(`${backend} memory is not implemented yet. Use chroma, skip, or POLYCODE_MEMORY_DRIVER=local for local development.`);
		this.name = 'UnsupportedMemoryBackendError';
	}
}

export function createMemoryStore(config: PolycodeConfig): MemoryStore {
	if (process.env.POLYCODE_MEMORY_DRIVER === 'local') {
		return LocalVectorMemoryStore.forProject(config.project.workingDirectory);
	}

	if (config.memory.backend === 'skip') {
		return new NullMemoryStore();
	}

	if (config.memory.backend === 'chroma') {
		return new ChromaMemoryStore();
	}

	throw new UnsupportedMemoryBackendError(config.memory.backend);
}

export async function getMemoryStats(config: PolycodeConfig | null): Promise<MemoryStats> {
	if (config === null) {
		return {
			backend: 'none',
			totalEmbeddings: 0,
			lastAccessedAt: null,
			status: 'not configured'
		};
	}

	try {
		return await createMemoryStore(config).stats();
	} catch (error) {
		return {
			backend: config.memory.backend,
			totalEmbeddings: 0,
			lastAccessedAt: null,
			status: error instanceof Error ? error.message : String(error)
		};
	}
}
