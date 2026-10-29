// The engine bundle: the server and the `roboratory` command in one file (D43). The packaged app runs it
// with its own binary in Node mode; `npm run cli` runs it in development.
import readline from 'node:readline';
import { main } from './cli';
import { buildIdOf } from './core/buildid';
import pkg from '../package.json';

void main(process.argv.slice(2), {
  // the override lets tests play an engine from an older version
  version: process.env.ROBORATORY_ENGINE_VERSION || pkg.version,
  build: buildIdOf(process.argv[1]),
  script: process.argv[1],
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  // a question to the person at the terminal; with no terminal there is no one to ask
  ask: process.stdin.isTTY ? (q) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${q} [y/N] `, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
  }) : undefined,
}).then((code) => { if (code !== undefined) process.exitCode = code; });
