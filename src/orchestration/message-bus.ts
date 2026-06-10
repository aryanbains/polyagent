import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';

export const AgentMessageSchema = z.object({
	id: z.string().min(1),
	from: z.string().min(1),
	to: z.union([z.string().min(1), z.literal('broadcast')]),
	type: z.enum(['request', 'response', 'delegation', 'result', 'status', 'error']),
	payload: z.unknown(),
	timestamp: z.coerce.date()
}).strict();

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export type AgentMessageInput = Omit<AgentMessage, 'id' | 'timestamp'> & {
	id?: string;
	timestamp?: Date;
};

type AgentMessageBusEvents = {
	message: [AgentMessage];
};

export class AgentMessageBus extends EventEmitter<AgentMessageBusEvents> {
	readonly history: AgentMessage[] = [];

	publish(input: AgentMessageInput): AgentMessage {
		const message = AgentMessageSchema.parse({
			id: input.id ?? randomUUID(),
			from: input.from,
			to: input.to,
			type: input.type,
			payload: input.payload,
			timestamp: input.timestamp ?? new Date()
		});

		this.history.push(message);
		this.emit('message', message);
		return message;
	}

	messagesFor(agentName: string): AgentMessage[] {
		return this.history.filter((message) => message.from === agentName || message.to === agentName || message.to === 'broadcast');
	}
}

export function createAgentMessageBus(): AgentMessageBus {
	return new AgentMessageBus();
}
