// Builds the Clicky Lite SDK bundle (sdk/clicky-lite.js) and the demo app's knowledge pack.
// Output is committed so the site runs on GitHub Pages with no build step.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'sdk/clicky-lite.js');
await build({
  entryPoints: [path.join(root, 'engine/sdk/src/index.ts')],
  outfile: out,
  bundle: true,
  format: 'iife',
  globalName: 'ClickyLiteSDK',
  minify: true,
  target: ['es2022', 'chrome110', 'firefox115', 'safari16'],
  legalComments: 'none',
  logLevel: 'warning',
  banner: { js: '/* Clicky Lite (unofficial concept) - built on the Navoro engine by Nitai Weinberg. */' },
  define: { 'process.env.NODE_ENV': '"production"', __NAVORO_SDK_VERSION__: '"0.1.0"' },
});
console.log(`[build] sdk/clicky-lite.js ${(statSync(out).size / 1024).toFixed(1)} KB`);
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'engine/scripts/clicky-pack.ts'), path.join(root, 'demo/clicky.config.json')], { stdio: 'inherit' });

// The demo also ships the pack as a script that sets a global, so it works where fetch
// can't reach the page's own files (sandboxed iframes with an opaque origin, file://).
const pack = readFileSync(path.join(root, 'demo/clicky-pack.json'), 'utf8').trim();
writeFileSync(
  path.join(root, 'demo/clicky-pack.js'),
  `/* Fernbill's Clicky Lite knowledge pack, built from demo/help by scripts/build.mjs. Do not edit. */\nwindow.FERNBILL_CLICKY_PACK = ${pack};\n`,
);
console.log('[build] demo/clicky-pack.js');
