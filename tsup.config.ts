import {defineConfig} from 'tsup';

export default defineConfig({
	entry: ['src/cli.tsx'],
	format: ['esm'],
	outDir: 'dist',
	clean: true,
	dts: true,
	sourcemap: true,
	splitting: false,
	treeshake: true,
	banner: {
		js: '#!/usr/bin/env node'
	}
});
