import { beforeEach } from 'vitest';

/**
 * jsdom is missing three browser APIs the component layer relies on.
 *
 * Stubbed rather than mocked away: `@lit-labs/virtualizer` measures with ResizeObserver and
 * IntersectionObserver, and refusing to provide them would mean the DOM tests could only
 * ever exercise components that do not scroll — which is most of what is worth testing
 * here. The stubs report a fixed viewport so the virtualizer renders a deterministic window.
 */
class StubObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): unknown[] {
		return [];
	}
}

if (!('ResizeObserver' in globalThis)) {
	(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubObserver;
}
if (!('IntersectionObserver' in globalThis)) {
	(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = StubObserver;
}

// uPlot calls matchMedia at module scope to watch for devicePixelRatio changes, and jsdom
// does not implement it — so merely *importing* a chart component throws, and every test in
// the file fails to collect with a message that says nothing about charts.
if (typeof globalThis.matchMedia !== 'function') {
	globalThis.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	})) as typeof globalThis.matchMedia;
}

/**
 * jsdom has no canvas 2D context, so uPlot cannot actually draw — but it very much *tries*.
 *
 * This used to return `null`, on the theory that the chart is never asked to paint. That was
 * wrong: uPlot's `_commit` runs on a microtask after `setData`, reaches straight for
 * `ctx.clearRect`, and threw ~70 times per run. Vitest reported those as "Errors" beside a
 * green summary, which is the worst of both worlds — noise loud enough to be ignored, in the
 * exact channel a real uncaught exception would arrive on.
 *
 * So: a context that accepts every call and returns something harmless. It asserts nothing
 * about rendering (`buildChartData` is the pure seam these tests assert on), it just lets
 * uPlot complete its frame instead of dying halfway through one.
 */
const NUMERIC_CONTEXT_PROPS = new Set(['lineWidth', 'globalAlpha', 'miterLimit', 'lineDashOffset']);

function stubCanvasContext(): CanvasRenderingContext2D {
	const noop = (): void => {};
	const written: Record<string, unknown> = {};
	const proxy = new Proxy(written, {
		get(target, property: string | symbol) {
			if (typeof property !== 'string') return undefined;
			// uPlot reads back what it writes — font, strokeStyle, lineWidth.
			if (property in target) return target[property];
			if (property === 'measureText') return () => ({ width: 0 });
			if (property === 'createLinearGradient') return () => ({ addColorStop: noop });
			if (property === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
			if (property === 'canvas') return undefined;
			return noop;
		},
		set(target, property: string | symbol, value: unknown) {
			if (typeof property === 'string') {
				target[property] = NUMERIC_CONTEXT_PROPS.has(property) ? Number(value) || 0 : value;
			}
			return true;
		},
	});
	return proxy as unknown as CanvasRenderingContext2D;
}

HTMLCanvasElement.prototype.getContext = ((kind: string) =>
	kind === '2d' ? stubCanvasContext() : null) as unknown as HTMLCanvasElement['getContext'];

// uPlot builds its series geometry as Path2D objects before handing them to the context.
// jsdom does not implement the class at all, so this is the second half of the same fix.
if (!('Path2D' in globalThis)) {
	(globalThis as unknown as { Path2D: unknown }).Path2D = class Path2D {
		addPath(): void {}
		closePath(): void {}
		moveTo(): void {}
		lineTo(): void {}
		bezierCurveTo(): void {}
		quadraticCurveTo(): void {}
		arc(): void {}
		arcTo(): void {}
		ellipse(): void {}
		rect(): void {}
		roundRect(): void {}
	};
}

/**
 * Pin the UI language, for the same reason `test/setup.ts` pins the timezone.
 *
 * The DOM assertions match on rendered English. Without this they would pass on a machine
 * whose browser reports `en-US` and fail on the developer's, which is worse than no suite —
 * and `AppStore`'s constructor reads both of these at boot.
 *
 * `localStorage` is shared across every test in a jsdom file, so a test that switches
 * language would leak into the next one and produce a failure that only reproduces in file
 * order. Clearing it here is what makes that impossible rather than unlikely.
 */
Object.defineProperty(navigator, 'languages', { configurable: true, value: ['en-US'] });
Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' });
beforeEach(() => {
	globalThis.localStorage?.clear();
});

// jsdom lays everything out at zero, so a virtualizer would compute a zero-row window.
// A fixed non-zero box makes the rendered window deterministic across runs.
Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, value: 900 });
Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
	return { x: 0, y: 0, width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600, toJSON: () => ({}) } as DOMRect;
};
