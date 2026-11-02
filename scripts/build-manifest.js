// Builds public/data/index.json: the list of tariff files the browser should load.
// Static hosts (Cloudflare Pages, GitHub Pages...) can't list a folder, so this runs at build time.
// Usage: node scripts/build-manifest.js

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTariff } from '../public/js/tariff.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

const files = (await readdir(dataDir))
  .filter((f) => f.toLowerCase().endsWith('.json') && f !== 'index.json')
  .sort();

let failed = false;
for (const f of files) {
  try {
    const result = validateTariff(JSON.parse(await readFile(join(dataDir, f), 'utf8')));
    if (!result.ok) throw new Error(result.errors.join(' '));
    result.warnings.forEach((w) => console.warn(`warning: ${f}: ${w}`));
  } catch (err) {
    failed = true;
    console.error(`error: ${f}: ${err.message}`);
  }
}

await writeFile(join(dataDir, 'index.json'), JSON.stringify({ files }, null, 2) + '\n');
console.log(`Wrote data/index.json with ${files.length} file(s).`);
if (failed) {
  console.error('Fix the files above - they will be skipped by the calculator.');
  process.exit(1);
}
