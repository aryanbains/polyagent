import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
		testTimeout: 15_000
	}
});
