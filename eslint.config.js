import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	// CLAUDE-SECURITY-*/ holds scan reports and, while a fix is being developed, a full
	// scratch clone of this repository. Without this the linter walks that copy and reports
	// every finding twice, against paths that are not the working tree.
	{ ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'CLAUDE-SECURITY-*/**'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.ts'],
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'no-restricted-syntax': [
				'error',
				{
					// See src/core/time.ts. Date.parse and new Date(string) are the two
					// ways this app could quietly get every timestamp wrong:
					//   new Date("2024-01-15")           -> UTC
					//   new Date("2024-01-15T00:00:00")  -> local
					// Same value in Python, an hour or more apart here. And a six-digit
					// fraction (the EMS writes microseconds) is outside the ES grammar, so
					// it falls to the engine's implementation-defined fallback parser.
					selector: "MemberExpression[object.name='Date'][property.name='parse']",
					message: 'Use parseStamp() from src/core/time.ts — Date.parse is locale- and engine-dependent.',
				},
				{
					selector: "NewExpression[callee.name='Date'][arguments.length=1]",
					message: 'new Date(x) with one argument is a string/epoch ambiguity. Use src/core/time.ts.',
				},
				{
					selector: 'ImportExpression',
					message: 'Dynamic import() cannot resolve from file:// — it breaks the single-file build.',
				},
			],
		},
	},
	{
		// The one module allowed to touch Date directly: it is the implementation the rule
		// above points everyone else at.
		files: ['src/core/time.ts'],
		rules: { 'no-restricted-syntax': 'off' },
	},
	{
		files: ['test/**/*.ts'],
		rules: { 'no-restricted-syntax': 'off' },
	},
	{
		// Build scripts run in Node, not the browser. Globals are declared explicitly
		// rather than pulling in the `globals` package for four names.
		files: ['scripts/**/*.mjs'],
		languageOptions: {
			globals: {
				process: 'readonly',
				console: 'readonly',
				Buffer: 'readonly',
				URL: 'readonly',
			},
		},
	},
);
