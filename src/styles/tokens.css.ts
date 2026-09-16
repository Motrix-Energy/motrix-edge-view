import { css } from 'lit';

/**
 * Design tokens, ported from the vanilla prototype's `:root` block.
 *
 * Declared on `:root` in index.html rather than here so they cross shadow-root
 * boundaries — custom properties inherit through shadow DOM, ordinary rules do not. This
 * module re-exports them as a `CSSResult` only so components can `import` a documented
 * dependency on them instead of quietly assuming a global.
 *
 * The prototype also hardcoded these same hex values a second time, inside its Plotly
 * layout object. Charts here still read the tokens — but they cannot read them the way the
 * DOM does, because **a canvas does not resolve `var(--…)`**. Assigning one to
 * `ctx.fillStyle` is an unparseable value, which is ignored silently rather than throwing,
 * so the context keeps the colour it already had: opaque black on a fresh one.
 * `motrix-chart-card.ts` handed uPlot `var(--…)` strings on that false assumption and painted
 * every axis label, tick and grid line black on a near-black panel, at about 1.25:1.
 *
 * It now resolves each token through `getComputedStyle` and hands uPlot the literal colour
 * (`MotrixChartCard.token`). Still one source of truth; the lookup just has to be explicit.
 * Anything else that paints into a canvas has to do the same.
 */
export const tokens = css`
	:host {
		/* Modernist, the system this brand rides: zero corner radius everywhere.
		   Kept as a token rather than deleted — 14 call sites read it. */
		--radius: 0px;
		--row-height: 36px;
	}
`;

/** Shared reset + typography for every shadow root. */
export const base = css`
	:host {
		box-sizing: border-box;
		font-family: var(--font-sans);
		color: var(--text-primary);
	}

	*,
	*::before,
	*::after {
		box-sizing: inherit;
	}

	button {
		font: inherit;
		color: inherit;
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 6px 12px;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	button:focus-visible,
	select:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	code,
	.mono {
		font-family: var(--font-mono);
	}
`;
