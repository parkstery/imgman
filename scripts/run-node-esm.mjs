/**
 * Bundle a TS verification script with esbuild (Node ESM, packages external)
 * and run it. Avoids tsx os.userInfo ENOMEM in this environment.
 *
 * Usage: node scripts/run-node-esm.mjs scripts/verify-foo.ts
 */
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = process.argv[2];
if (!entry) {
  console.error('usage: node scripts/run-node-esm.mjs <file.ts>');
  process.exit(1);
}

const absEntry = path.resolve(entry);
const outfile = path.join(here, `.tmp-${path.basename(absEntry, path.extname(absEntry))}.mjs`);

esbuild.buildSync({
  entryPoints: [absEntry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile,
  logLevel: 'silent',
});

const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: process.env,
});

try {
  fs.unlinkSync(outfile);
} catch {
  /* ignore */
}

process.exit(result.status ?? 1);
