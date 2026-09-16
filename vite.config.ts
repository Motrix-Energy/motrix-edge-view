import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The deliverable is ONE self-contained index.html you can double-click. An EMS lives on
// a site LAN, and a local debugging tool that needs the internet to render is the wrong
// shape — so every dependency is vendored and inlined, and nothing is fetched at runtime.
//
// Opening the result over file:// forbids more than it looks like, and several choices
// below exist only because of it:
//   - dynamic import() resolves against an opaque origin and fails  -> inlineDynamicImports
//   - external asset URLs fail                                      -> assetsInlineLimit
//   - blob-URL Web Workers are blocked                              -> no PapaParse worker
// scripts/check-bundle-size.mjs asserts the output really is one file with no external
// references, because vite-plugin-singlefile stops inlining *silently* past the limits.
export default defineConfig({
	plugins: [viteSingleFile({ removeViteModuleLoader: true })],
	build: {
		target: 'es2022',
		cssCodeSplit: false,
		// The preload polyfill injects a helper that builds <link rel=modulepreload> at
		// runtime. With dynamic import() banned and every asset inlined there is nothing for
		// it to preload, so it is dead weight — and its `crossOrigin` assignment is exactly
		// the kind of network-reaching code the single-file check is watching for.
		modulePreload: { polyfill: false },
		assetsInlineLimit: 100_000_000,
		chunkSizeWarningLimit: 100_000_000,
		reportCompressedSize: false,
		rollupOptions: {
			output: { inlineDynamicImports: true },
		},
	},
	server: {
		port: 5173,
		proxy: {
			// The dev-side twin of docker/nginx.conf's `proxy_pass http://edge:8000/`.
			// The EMS serves bare /health, /devices, /workers — FastAPI's root_path only
			// relabels /docs and /openapi.json, it does not remount the routes — so the
			// /api prefix has to be stripped here exactly as nginx strips it there.
			// THESE TWO FILES MUST CHANGE TOGETHER.
			'/api': {
				target: 'http://127.0.0.1:8000',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, ''),
			},
		},
	},
});
