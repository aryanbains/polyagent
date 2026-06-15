import {describe, expect, it} from 'vitest';
import {ApprovalRequestQueue} from '../src/ui/approval-queue.js';

describe('ApprovalRequestQueue', () => {
	it('serializes concurrent approval requests without losing promises', async () => {
		const queue = new ApprovalRequestQueue();
		const results: boolean[] = [];
		const first = new Promise<boolean>((resolve) => {
			queue.enqueue('first write', resolve);
		}).then((approved) => {
			results.push(approved);
			return approved;
		});
		const second = new Promise<boolean>((resolve) => {
			queue.enqueue('second write', resolve);
		}).then((approved) => {
			results.push(approved);
			return approved;
		});
		const third = new Promise<boolean>((resolve) => {
			queue.enqueue('third write', resolve);
		}).then((approved) => {
			results.push(approved);
			return approved;
		});

		expect(queue.current()?.message).toBe('first write');
		expect(queue.queuedCount()).toBe(2);

		queue.resolveActive(true);
		expect(queue.current()?.message).toBe('second write');
		expect(queue.queuedCount()).toBe(1);
		await expect(first).resolves.toBe(true);

		queue.resolveActive(false);
		expect(queue.current()?.message).toBe('third write');
		expect(queue.queuedCount()).toBe(0);
		await expect(second).resolves.toBe(false);

		queue.resolveActive(true);
		expect(queue.current()).toBeNull();
		await expect(third).resolves.toBe(true);
		expect(results).toEqual([true, false, true]);
	});

	it('cancels one queued approval without losing the rest', async () => {
		const queue = new ApprovalRequestQueue();
		const results: string[] = [];
		const first = queue.enqueue('first', (approved) => {
			results.push(`first:${approved}`);
		});
		const second = queue.enqueue('second', (approved) => {
			results.push(`second:${approved}`);
		});
		const third = queue.enqueue('third', (approved) => {
			results.push(`third:${approved}`);
		});

		expect(first.id).not.toBe(second.id);
		queue.cancel(second.id, false);
		expect(queue.current()?.message).toBe('first');
		expect(queue.queuedCount()).toBe(1);

		queue.resolveActive(true);
		expect(queue.current()?.id).toBe(third.id);
		queue.resolveActive(true);

		expect(results).toEqual(['second:false', 'first:true', 'third:true']);
	});
});
