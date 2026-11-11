import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const source = new URL('../integrations/omarchy/pain/Model.js', import.meta.url);
const target = new URL('../desktop/src/model.js', import.meta.url);
// QML and web views execute the same helpers. No hand-maintained translation.
const text = readFileSync(source, 'utf8').replace(/^\.pragma library\s*$/m, '').replace(/^function /gm, 'export function ');
writeFileSync(target, '// Generated from the Omarchy Model.js. Do not edit.\n' + text);
mkdirSync(new URL('../desktop/public/omarchy', import.meta.url), { recursive: true });
