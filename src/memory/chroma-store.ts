import {ChromaClient, type Collection} from 'chromadb';
import {createEmbedder, type Embedder} from './embedder.js';
import type {MemorySearchResult, MemoryStats, MemoryStore} from './types.js';

export class ChromaUnavailableError extends Error {
	constructor(endpoint = 'http://localhost:8000') {
		const message = `ChromaDB is not reachable at ${endpoint}. Start ChromaDB or run polyagent init --memory skip to disable memory.`;
		super(message);
		this.name = 'ChromaUnavailableError';
	}
}

type ChromaMetadata = {
	agentName: string;
	createdAt: string;
};

export class ChromaMemoryStore implements MemoryStore {
	readonly backend = 'chroma';
	private readonly client: ChromaClient;
	private readonly endpoint: string;

	constructor(
		private readonly collectionName = 'polyagent_memory',
		private readonly embedder: Embedder = createEmbedder()
	) {
		const host = process.env.CHROMA_HOST ?? 'localhost';
		const port = Number(process.env.CHROMA_PORT ?? 8000);
		this.endpoint = `http://${host}:${port}`;
		this.client = new ChromaClient({
			host,
			port
		});
	}

	async add(agentName: string, content: string): Promise<void> {
		const collection = await this.getCollection();
		const now = new Date().toISOString();

		await collection.add({
			ids: [`${agentName}-${Date.now()}-${Math.random().toString(36).slice(2)}`],
			embeddings: [await this.embedder.embed(content)],
			documents: [content],
			metadatas: [{agentName, createdAt: now}]
		});
	}

	async search(agentName: string, query: string, limit: number): Promise<MemorySearchResult[]> {
		const collection = await this.getCollection();
		const result = await collection.query<ChromaMetadata>({
			queryEmbeddings: [await this.embedder.embed(query)],
			nResults: limit,
			where: {agentName: {$eq: agentName}} as never,
			include: ['documents', 'metadatas', 'distances']
		});
		const documents = result.documents[0] ?? [];
		const metadatas = result.metadatas[0] ?? [];
		const distances = result.distances?.[0] ?? [];

		return documents.map((document, index) => ({
			record: {
				id: result.ids[0]?.[index] ?? `${agentName}-${index}`,
				agentName,
				content: document ?? '',
				embedding: [],
				createdAt: metadatas[index]?.createdAt ?? new Date(0).toISOString()
			},
			score: 1 - (distances[index] ?? 1)
		}));
	}

	async stats(agentName?: string): Promise<MemoryStats> {
		const collection = await this.getCollection();
		const count = agentName === undefined
			? await collection.count()
			: (await collection.get<ChromaMetadata>({
				where: {agentName: {$eq: agentName}} as never,
				include: ['metadatas']
			})).ids.length;

		return {
			backend: this.backend,
			totalEmbeddings: count,
			lastAccessedAt: null,
			status: 'ready'
		};
	}

	async clear(agentName?: string): Promise<void> {
		const collection = await this.getCollection();

		if (agentName === undefined) {
			const records = await collection.get({include: []});
			await collection.delete({ids: records.ids});
			return;
		}

		await collection.delete({where: {agentName: {$eq: agentName}} as never});
	}

	private async getCollection(): Promise<Collection> {
		try {
			await this.client.heartbeat();
			return await this.client.getOrCreateCollection({name: this.collectionName, embeddingFunction: null});
		} catch (error) {
			if (error instanceof ChromaUnavailableError) {
				throw error;
			}

			throw new ChromaUnavailableError(this.endpoint);
		}
	}
}
