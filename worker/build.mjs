// Copies the static site into dist/ for Workers Static Assets.
// Only what's listed here is published; dev-only folders named "tools" are skipped.
import { cpSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const PUBLISH = ['index.html', 'games', 'shared', 'ssh'];

rmSync(out, { recursive: true, force: true });
for (const entry of PUBLISH) {
  cpSync(join(root, entry), join(out, entry), {
    recursive: true,
    filter: (src) => !['tools', 'node_modules'].includes(basename(src)) && !basename(src).startsWith('.'),
  });
}
console.log(`Built ${PUBLISH.join(', ')} into dist/`);
