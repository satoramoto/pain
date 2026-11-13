import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const resources = `${root}/desktop/src-tauri/resources`;
mkdirSync(`${resources}/payload`, {recursive:true}); mkdirSync(`${resources}/runtime`, {recursive:true});
for (const path of ['ai','comfy_backend.py','paintop','backends','compose.yaml','containers','integrations/macos','models']) {
  cpSync(`${root}/${path}`,`${resources}/payload/${path}`,{recursive:true,filter:p=>!p.includes('__pycache__')});
}
for (const name of ['pain-macos-runtime-arm64.tar.gz','pain-macos-runtime-arm64.tar.gz.sha256']) {
  if (!existsSync(`${root}/.build/${name}`)) throw new Error(`Build the Mac runtime first: missing ${name}`);
  cpSync(`${root}/.build/${name}`,`${resources}/runtime/${name}`);
}
