// The engine bundle: the server and the `roboratory` command in one file (D43). The packaged app runs it
// with its own binary in Node mode; `npm run cli` runs it in development.
import { main } from './cli';
import pkg from '../package.json';

void main(process.argv.slice(2), {
  // the override lets tests play an engine from an older version
  version: process.env.ROBORATORY_ENGINE_VERSION || pkg.version,
  script: process.argv[1],
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
}).then((code) => { if (code !== undefined) process.exitCode = code; });
