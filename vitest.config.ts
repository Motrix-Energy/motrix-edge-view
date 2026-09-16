import { defineConfig } from 'vitest/config';

// Two projects. Everything under src/core and src/sources is pure and runs in node, which
// keeps the bulk of the suite fast; only components need a DOM.
//
// uPlot is never unit-tested: jsdom has no canvas 2D context, and there would be nothing
// to assert if it did. That is exactly why buildChartData() is a pure function — the whole
// slice -> downsample -> align -> axes pipeline is testable without a browser, and uPlot's
// job is narrowed to "render the array we hand you".
export default defineConfig({
	test: {
		// Set here rather than left to the shell so the suite behaves identically on a
		// developer's laptop and on CI. Node applies a runtime TZ assignment, and
		// test/setup.ts asserts it took effect rather than trusting that it did.
		env: { TZ: 'Europe/Brussels' },
		setupFiles: ['./test/setup.ts'],
		projects: [
			{
				extends: true,
				test: {
					name: 'core',
					environment: 'node',
					include: ['test/**/*.test.ts'],
					exclude: ['test/**/*.dom.test.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'dom',
					environment: 'jsdom',
					include: ['test/**/*.dom.test.ts'],
					setupFiles: ['./test/setup.ts', './test/dom-setup.ts'],
				},
			},
		],
	},
});
