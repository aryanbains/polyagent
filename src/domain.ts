export const APP_NAME = 'Polyagent';
export const COMMAND_NAME = 'polyagent';
export const CONFIG_DIRECTORY_NAME = '.polyagent';
export const CONFIG_FILE_NAME = 'config.json';

export const PROVIDERS = ['openai', 'anthropic', 'groq', 'ollama', 'openrouter'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const MEMORY_BACKENDS = ['chroma', 'pinecone', 'skip'] as const;
export type MemoryBackend = (typeof MEMORY_BACKENDS)[number];

export type EncryptedSecret = {
	storage: 'local-aes-256-gcm';
	algorithm: 'aes-256-gcm';
	iv: string;
	tag: string;
	ciphertext: string;
};

export type PolyagentConfig = {
	version: 1;
	project: {
		name: string;
		workingDirectory: string;
	};
	llm: {
		provider: Provider;
		apiKey: EncryptedSecret | null;
	};
	memory: {
		backend: MemoryBackend;
	};
	createdAt: string;
	updatedAt: string;
};

export type InitOptions = {
	projectName: string;
	workingDirectory: string;
	provider: Provider;
	apiKey?: string;
	memoryBackend: MemoryBackend;
};
