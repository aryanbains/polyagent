import type {MemorySearchResult, MemoryStats, MemoryStore} from './types.js';

export class NullMemoryStore implements MemoryStore {
	readonly backend = 'skip';

	async add(): Promise<void> {}

	async search(): Promise<MemorySearchResult[]> {
		return [];
	}

	async stats(): Promise<MemoryStats> {
		return {
			backend: this.backend,
			totalEmbeddings: 0,
			lastAccessedAt: null,
			status: 'disabled'
		};
	}

	async clear(): Promise<void> {}
}
