import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createEmbedder, type Embedder} from './embedder.js';
import type {MemoryRecord, MemorySearchResult, MemoryStats, MemoryStore} from './types.js';

type MemoryFile = {
	records: MemoryRecord[];
};

function cosineSimilarity(left: number[], right: number[]): number {
	const length = Math.min(left.length, right.length);
	let dot = 0;
	let leftMagnitude = 0;
	let rightMagnitude = 0;

	for (let index = 0; index < length; index++) {
		const leftValue = left[index] ?? 0;
		const rightValue = right[index] ?? 0;
		dot += leftValue * rightValue;
		leftMagnitude += leftValue ** 2;
		rightMagnitude += rightValue ** 2;
	}

	return dot / ((Math.sqrt(leftMagnitude) || 1) * (Math.sqrt(rightMagnitude) || 1));
}

export class LocalVectorMemoryStore implements MemoryStore {
	readonly backend = 'local';

	constructor(
		private readonly storagePath: string,
		private readonly embedder: Embedder = createEmbedder()
	) {}

	static forProject(workingDirectory: string): LocalVectorMemoryStore {
		return new LocalVectorMemoryStore(path.join(workingDirectory, '.polycode', 'memory.json'));
	}

	async add(agentName: string, content: string): Promise<void> {
		if (content.trim().length === 0) {
			return;
		}

		const memoryFile = await this.readMemoryFile();
		memoryFile.records.push({
			id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			agentName,
			content,
			embedding: await this.embedder.embed(content),
			createdAt: new Date().toISOString()
		});
		await this.writeMemoryFile(memoryFile);
	}

	async search(agentName: string, query: string, limit: number): Promise<MemorySearchResult[]> {
		const memoryFile = await this.readMemoryFile();
		const queryEmbedding = await this.embedder.embed(query);

		return memoryFile.records
			.filter((record) => record.agentName === agentName)
			.map((record) => ({
				record,
				score: cosineSimilarity(record.embedding, queryEmbedding)
			}))
			.sort((left, right) => right.score - left.score)
			.slice(0, limit);
	}

	async stats(agentName?: string): Promise<MemoryStats> {
		const memoryFile = await this.readMemoryFile();
		const records = agentName === undefined ? memoryFile.records : memoryFile.records.filter((record) => record.agentName === agentName);
		const lastAccessedAt = records.reduce<string | null>((latest, record) => {
			if (latest === null || record.createdAt > latest) {
				return record.createdAt;
			}

			return latest;
		}, null);

		return {
			backend: this.backend,
			totalEmbeddings: records.length,
			lastAccessedAt,
			storagePath: this.storagePath,
			status: 'ready'
		};
	}

	async clear(agentName?: string): Promise<void> {
		const memoryFile = await this.readMemoryFile();
		const records = agentName === undefined ? [] : memoryFile.records.filter((record) => record.agentName !== agentName);
		await this.writeMemoryFile({records});
	}

	private async readMemoryFile(): Promise<MemoryFile> {
		try {
			return JSON.parse(await readFile(this.storagePath, 'utf8')) as MemoryFile;
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
				return {records: []};
			}

			throw error;
		}
	}

	private async writeMemoryFile(memoryFile: MemoryFile): Promise<void> {
		await mkdir(path.dirname(this.storagePath), {recursive: true});
		await writeFile(this.storagePath, `${JSON.stringify(memoryFile, null, 2)}\n`);
	}
}
