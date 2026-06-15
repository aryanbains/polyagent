import type {z} from 'zod';

export type ToolApprovalMode = 'prompt' | 'allow' | 'deny';
export type WebSearchProvider = 'auto' | 'duckduckgo' | 'tavily';

export type ToolContext = {
	workingDirectory: string;
	approvalMode: ToolApprovalMode;
	abortSignal?: AbortSignal;
	agentName?: string;
	availableAgents?: string[];
	webSearchProvider?: WebSearchProvider;
	fetch?: typeof fetch;
	onPreview?: (preview: string) => void;
	requestApproval?: (message: string, preview?: string, abortSignal?: AbortSignal) => Promise<boolean>;
	sendAgentMessage?: (input: {
		from: string;
		to: string;
		message: string;
		expectResponse: boolean;
	}) => Promise<ToolResult> | ToolResult;
};

export type ToolResult = {
	ok: boolean;
	message: string;
	data?: unknown;
};

export type ToolDefinition<InputSchema extends z.ZodType = z.ZodType> = {
	name: string;
	description: string;
	inputSchema: InputSchema;
	execute: (input: z.infer<InputSchema> & any, context: ToolContext) => Promise<ToolResult>;
};
