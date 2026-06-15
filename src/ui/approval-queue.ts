export type QueuedApproval = {
	id: number;
	message: string;
	resolve: (approved: boolean) => void;
};

export class ApprovalRequestQueue {
	private active: QueuedApproval | null = null;
	private readonly queue: QueuedApproval[] = [];
	private nextId = 1;

	enqueue(message: string, resolve: (approved: boolean) => void): QueuedApproval {
		const request: QueuedApproval = {
			id: this.nextId,
			message,
			resolve
		};
		this.nextId += 1;

		if (this.active === null) {
			this.active = request;
			return request;
		}

		this.queue.push(request);
		return request;
	}

	resolveActive(approved: boolean): QueuedApproval | null {
		const current = this.active;

		if (current === null) {
			return null;
		}

		current.resolve(approved);
		this.active = this.queue.shift() ?? null;
		return current;
	}

	cancel(id: number, approved = false): QueuedApproval | null {
		if (this.active?.id === id) {
			return this.resolveActive(approved);
		}

		const index = this.queue.findIndex((request) => request.id === id);

		if (index === -1) {
			return null;
		}

		const [request] = this.queue.splice(index, 1);
		request?.resolve(approved);
		return request ?? null;
	}

	current(): QueuedApproval | null {
		return this.active;
	}

	queuedCount(): number {
		return this.queue.length;
	}

	clear(approved = false): void {
		const requests = [
			...(this.active === null ? [] : [this.active]),
			...this.queue
		];
		this.active = null;
		this.queue.length = 0;

		for (const request of requests) {
			request.resolve(approved);
		}
	}
}
