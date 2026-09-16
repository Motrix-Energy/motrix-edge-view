/**
 * The timezone is part of the contract under test.
 *
 * The EMS writes naive timestamps for live runs, and this app interprets a naive value as
 * local to the machine that wrote the file. Half the assertions in time.test.ts — the DST
 * fold, the DST gap, the offset-vs-naive divergence — are meaningless in UTC and would
 * pass vacuously on a CI box while failing on a developer's laptop. A suite that is green
 * in one place and red in another is worse than no suite, so fail loudly instead.
 *
 * vitest.config.ts does not set it: `TZ` has to be in the environment before the process
 * starts for the platform's date routines to pick it up on every OS.
 */
const REQUIRED_TZ = 'Europe/Brussels';

const actual = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (actual !== REQUIRED_TZ) {
	throw new Error(
		`These tests require TZ=${REQUIRED_TZ}, but the process resolved "${actual}".\n` +
			`Run them as: TZ=${REQUIRED_TZ} npm test   (cross-env or the CI env: block on Windows)`,
	);
}
