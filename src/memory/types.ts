export type MemoryRecord = {
	id: string;
	agentName: string;
	content: string;
	embedding: number[];
	createdAt: string;
};

export type MemorySearchResult = {
	record: MemoryRecord;
	score: number;
};

export type MemoryStats = {
	backend: string;
	totalEmbeddings: number;
	lastAccessedAt: string | null;
	storagePath?: string;
	status?: string;
};

export interface MemoryStore {
	readonly backend: string;
	add(agentName: string, content: string): Promise<void>;
	search(agentName: string, query: string, limit: number): Promise<MemorySearchResult[]>;
	stats(agentName?: string): Promise<MemoryStats>;
	clear(agentName?: string): Promise<void>;
}
