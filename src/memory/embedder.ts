export interface Embedder {
	embed(text: string): Promise<number[]>;
}

export class HashEmbedder implements Embedder {
	constructor(private readonly dimensions = 64) {}

	async embed(text: string): Promise<number[]> {
		const vector = Array.from({length: this.dimensions}, () => 0);
		const normalized = text.toLowerCase();

		for (const token of normalized.split(/\W+/).filter(Boolean)) {
			let hash = 2166136261;

			for (const character of token) {
				hash ^= character.charCodeAt(0);
				hash = Math.imul(hash, 16777619);
			}

			const index = Math.abs(hash) % this.dimensions;
			vector[index] = (vector[index] ?? 0) + 1;
		}

		const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0)) || 1;
		return vector.map((value) => value / magnitude);
	}
}

export class TransformersEmbedder implements Embedder {
	private extractorPromise: Promise<(text: string, options: {pooling: 'mean'; normalize: boolean}) => Promise<{data: Iterable<number>}>> | null = null;

	async embed(text: string): Promise<number[]> {
		const extractor = await this.getExtractor();
		const output = await extractor(text, {pooling: 'mean', normalize: true});
		return Array.from(output.data);
	}

	private async getExtractor(): Promise<(text: string, options: {pooling: 'mean'; normalize: boolean}) => Promise<{data: Iterable<number>}>> {
		this.extractorPromise ??= import('@xenova/transformers').then(async ({pipeline}) => {
			return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as Promise<(text: string, options: {pooling: 'mean'; normalize: boolean}) => Promise<{data: Iterable<number>}>>;
		});

		return this.extractorPromise;
	}
}

export class FallbackEmbedder implements Embedder {
	constructor(
		private readonly primary: Embedder,
		private readonly fallback: Embedder
	) {}

	async embed(text: string): Promise<number[]> {
		try {
			return await this.primary.embed(text);
		} catch {
			return this.fallback.embed(text);
		}
	}
}

export function createEmbedder(): Embedder {
	if (process.env.POLYAGENT_EMBEDDINGS === 'hash') {
		return new HashEmbedder();
	}

	if (process.env.POLYAGENT_EMBEDDINGS === 'transformers') {
		return new TransformersEmbedder();
	}

	return new FallbackEmbedder(new TransformersEmbedder(), new HashEmbedder());
}
