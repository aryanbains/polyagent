export class RunCancelledError extends Error {
	constructor(message = 'Run cancelled.') {
		super(message);
		this.name = 'RunCancelledError';
	}
}

export function isAbortLikeError(error: unknown): boolean {
	if (error instanceof RunCancelledError) {
		return true;
	}

	if (error instanceof Error) {
		return error.name === 'AbortError' || /\baborted\b|\babort\b|\bcancelled\b|\bcanceled\b/i.test(error.message);
	}

	return false;
}

export function isRunCancelled(error: unknown): boolean {
	return error instanceof RunCancelledError || isAbortLikeError(error);
}

export function throwIfAborted(signal: AbortSignal | undefined, message = 'Run cancelled.'): void {
	if (signal?.aborted === true) {
		const reason = signal.reason;

		if (reason instanceof Error) {
			throw reason;
		}

		throw new RunCancelledError(typeof reason === 'string' && reason.length > 0 ? reason : message);
	}
}

export function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
	const validSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);

	if (validSignals.length === 0) {
		return undefined;
	}

	if (validSignals.length === 1) {
		return validSignals[0];
	}

	const controller = new AbortController();
	const abort = (signal: AbortSignal): void => {
		if (!controller.signal.aborted) {
			controller.abort(signal.reason ?? new RunCancelledError());
		}
	};

	for (const signal of validSignals) {
		if (signal.aborted) {
			abort(signal);
			return controller.signal;
		}

		signal.addEventListener('abort', () => {
			abort(signal);
		}, {once: true});
	}

	return controller.signal;
}
