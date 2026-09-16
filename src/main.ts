/**
 * Entry point. Registers the root element and nothing else.
 *
 * Imports are static everywhere in this app on purpose: dynamic `import()` resolves
 * against an opaque origin under `file://` and fails, which would break the deliverable
 * for the exact audience it is built for. eslint.config.js enforces it.
 */
import './styles/fonts.css';
import './components/motrix-app.js';
