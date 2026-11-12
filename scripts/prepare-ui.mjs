import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const target = new URL('.build/pain-ui/', root);
const pkg = JSON.parse(readFileSync(new URL('desktop/package.json', root), 'utf8'));
const archive = pkg.devDependencies['@satoramoto/zen'];
const revision = archive.match(/\/([a-f0-9]{40})\.tar\.gz$/)?.[1];
if (!revision) throw new Error('PAIN requires a full-SHA Zen dependency.');
const require = createRequire(new URL('desktop/package.json', root));
const files = ['ui.mjs', 'ui.d.mts', 'layout.mjs', 'layout.d.mts', 'theme.mjs', 'theme.d.mts', 'Tree.qml', 'Theme.qml'];
mkdirSync(target, { recursive: true });

// Use the installed, locked dependency for desktop builds. Native-only installs
// fetch just the portable kit from the same immutable revision, without npm.
let installed;
try {
  const lock = JSON.parse(readFileSync(new URL('desktop/package-lock.json', root), 'utf8'));
  if (lock.packages['node_modules/@satoramoto/zen'].resolved === archive)
    installed = new URL('./', pathToFileURL(require.resolve('@satoramoto/zen/harness/omarchy/kit/ui.mjs')));
} catch { /* Native Omarchy installations do not need desktop node_modules. */ }
const provenance = new URL('source.json', target);
let cachedRevision;
try { cachedRevision = JSON.parse(readFileSync(provenance, 'utf8')).revision; } catch { /* First build. */ }
for (const name of files) {
  const output = new URL(name, target);
  if (installed) writeFileSync(output, readFileSync(new URL(name, installed)));
  else if (cachedRevision !== revision || !existsSync(output)) {
    const url = `https://raw.githubusercontent.com/satoramoto/zen/${revision}/src/harness/omarchy/kit/${name}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to prepare Zen ${name}: HTTP ${response.status}`);
    writeFileSync(output, await response.text());
  }
}
writeFileSync(provenance, JSON.stringify({ revision, archive, files }, null, 2) + '\n');
const helpers = readFileSync(new URL('integrations/omarchy/pain/Model.js', root), 'utf8')
  .replace(/^\.pragma library\s*$/m, '').replace(/^function /gm, 'export function ');
writeFileSync(new URL('model.mjs', target), '// Generated from Model.js. Do not edit.\n' + helpers);
const kitLink = new URL('integrations/omarchy/pain/.generated', root);
const relativeKit = '../../../.build/pain-ui';
try {
  if (!lstatSync(kitLink).isSymbolicLink() || readlinkSync(kitLink) !== relativeKit)
    throw new Error('Refusing to replace integrations/omarchy/pain/.generated');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  symlinkSync(relativeKit, kitLink, 'dir');
}
mkdirSync(new URL('desktop/public/omarchy/', root), { recursive: true });
