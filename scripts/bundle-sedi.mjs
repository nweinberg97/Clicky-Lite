// Bundles the Sedi demo (demo/app.js and its ES modules) into one classic script, demo/sedi.bundle.js,
// because sandboxed previews with an opaque origin can't load ES modules (CORS). Run after editing demo/js.
import { build } from 'esbuild';
await build({
  entryPoints: ['demo/app.js'], bundle: true, format: 'iife', outfile: 'demo/sedi.bundle.js',
  target: ['es2022'], minify: true, legalComments: 'none', logLevel: 'warning',
  // Sedi's modules locate their workers and models relative to demo/js/.
  define: { 'import.meta.url': '__SEDI_MODULE_URL' },
  banner: { js: '/* Sedi by Nitai Weinberg, bundled for the Clicky Lite demo. */\nvar __SEDI_MODULE_URL = new URL("js/app.js", (document.currentScript && document.currentScript.src) || location.href).href;' },
});
console.log('[bundle] demo/sedi.bundle.js');
