// Runs the engine and the `roboratory` command from source: bundles src/engine.ts, then runs it with this Node.
// Usage: npm run cli -- <command> [options]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, '.vite', 'cli', 'engine.cjs');
await build({ entryPoints: [path.join(root, 'src', 'engine.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile, logLevel: 'error' });
const r = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
