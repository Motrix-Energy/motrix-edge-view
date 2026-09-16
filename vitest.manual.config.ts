import { defineConfig } from 'vitest/config';

/**
 * The manual harnesses, which `vitest.config.ts` deliberately does not include.
 *
 * Its projects match `test/**\/*.test.ts`; anything ending `.manual.ts` is invisible to
 * `npm test` on purpose, because these need a live EMS on 127.0.0.1:8000 and run for
 * minutes. Kept as a separate config rather than a flag so the command is memorable:
 *
 *     npx vitest run --config vitest.manual.config.ts
 */
export default defineConfig({
	test: {
		include: ['test/**/*.manual.ts'],
		environment: 'node',
		testTimeout: 400_000,
		hookTimeout: 400_000,
	},
});
