// Builds the Clicky Lite SDK bundle (sdk/clicky-lite.js) and the demo app's knowledge pack.
// Output is committed so the site runs on GitHub Pages with no build step.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
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
