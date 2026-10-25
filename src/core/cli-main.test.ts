// The command line as a person types it, in-process against a real engine on a real socket. (The same command run as a
// separate process, with the engine started on demand, is in cli.test.ts.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, USAGE } from '../cli';
import { createDemoFactory } from './demo';
import { startServer, type EngineServer } from './server';
import { until } from '../test/harness';

const RELEASES = 'releases/orders-api';

let server: EngineServer | null = null;
afterEach(async () => { await server?.close(); server = null; vi.restoreAllMocks(); });

function demo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-clim-'));
  return createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
}

/** Types a command; returns the exit code and what it printed. */
async function run(root: string | null, ...argv: string[]) {
  let out = '', err = '';
  const code = await main(root ? [...argv, '--factory', root] : argv, { version: '1.2.3', build: 'b1', script: 'engine.js', out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

describe('The roboratory command', () => {
  describe('before it talks to any engine', () => {
    it('prints how to use it when you type nothing, and exits with a usage error', async () => {
      const r = await run(null);
      expect(r.code).toBe(2);
      expect(r.out).toBe(USAGE);
    });

    it.each([['help'], ['--help'], ['-h']])('prints how to use it for %s', async (word) => {
      const r = await run(null, word);
      expect(r.code).toBe(0);
      expect(r.out).toContain('roboratory <command>');
    });

    it('prints its version', async () => {
      expect((await run(null, 'version')).out).toBe('1.2.3\n');
      expect((await run(null, '--version')).out).toBe('1.2.3\n');
    });

    it('refuses a command it does not know, and shows the usage', async () => {
      const r = await run(null, 'frobnicate');
      expect(r.code).toBe(2);
      expect(r.err).toContain('Unknown command "frobnicate"');
      expect(r.err).toContain('roboratory <command>');
    });

    it('refuses an option that has no value', async () => {
      const r = await run(null, 'run', 'l', '--input');
      expect(r.code).toBe(2);
      expect(r.err).toContain('--input needs a value');
    });

    it('says when --factory is not a factory', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-clim-'));
      const r = await run(dir, 'status');
      expect(r.code).toBe(1);
      expect(r.err).toContain('is not a Roboratory factory');
    });

    it('finds the factory you are in, or the one above, and says when there is none', async () => {
      const root = demo();
      vi.spyOn(process, 'cwd').mockReturnValue(path.join(root, 'sectors', 'releases'));
      expect((await run(null, 'status')).out).toContain('No engine is running');

      vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
      const none = await run(null, 'status');
      expect(none.code).toBe(1);
      expect(none.err).toContain('No factory here');
    });

    it('takes the factory from the environment', async () => {
      const root = demo();
      process.env.ROBORATORY_FACTORY = root;
      try { expect((await run(null, 'status')).out).toContain(root); } finally { delete process.env.ROBORATORY_FACTORY; }
    });
  });

  describe('with an engine running', () => {
    async function engine() {
      const root = demo();
      server = await startServer(root, { version: '1.2.3', build: 'b1' });
      return root;
    }

    it('reports the engine, its lines and what needs you', async () => {
      const root = await engine();
      const idle = await run(root, 'status');
      expect(idle.out).toContain('Engine 1.2.3');
      expect(idle.out).toContain(`line ${RELEASES}`);

      await run(root, 'run', RELEASES, '--input', 'tag=v1');
      expect(await statusSays(root, /needs you: Launch/)).toBe(true);
      expect((await run(root, 'status')).out).toMatch(/run .* on releases\/orders-api: running/);
    });

    it('warns when the engine is another build than the command', async () => {
      const root = demo();
      server = await startServer(root, { version: '1.2.3', build: 'old' });
      expect((await run(root, 'status')).out).toContain("The engine is not this command's build");
    });

    it('accepts a line by the end of its id when that is unambiguous, and says when it is not', async () => {
      const root = await engine();
      expect((await run(root, 'run', 'orders-api', '--input', 'tag=v1')).err).toContain('is ambiguous');
      expect((await run(root, 'halt', 'nowhere')).err).toContain('Unknown line "nowhere"');
      expect((await run(root, 'halt', 'orders-api')).err).toContain('ambiguous');
      expect((await run(root, 'halt', RELEASES)).out).toBe('Halted.\n');
      expect((await run(root, 'resume', RELEASES)).out).toBe('Resumed.\n');
    });

    it('wants the input a line requires, as key=value', async () => {
      const root = await engine();
      expect((await run(root, 'run', RELEASES)).err).toContain('Missing input');
      const bad = await run(root, 'run', RELEASES, '--input', 'tag');
      expect(bad.code).toBe(1);
      expect(bad.err).toContain('--input wants key=value');
    });

    it('prints the id of the run it starts', async () => {
      const root = await engine();
      const r = await run(root, 'run', RELEASES, '--input', 'tag=v2');
      expect(r.code).toBe(0);
      expect(r.out.trim()).toMatch(/^\d{4}.*-/);
    });

    it('asks you to give each confirmation of a gate that wants several, and releases when you do', async () => {
      const root = await engine();
      await run(root, 'run', RELEASES, '--input', 'tag=v3');
      expect(await statusSays(root, /needs you: Launch/)).toBe(true);
      const refused = await run(root, 'release', RELEASES, 'launch');
      expect(refused.code).toBe(1);
      expect(refused.err).toContain('Pass --confirm 2');
      const released = await run(root, 'release', RELEASES, 'launch', '--confirm', '2');
      expect(released).toMatchObject({ code: 0, out: 'Released.\n' });
    });

    it('needs the arguments each command takes, and says how to type it', async () => {
      const root = await engine();
      for (const [argv, usage] of [[['release', RELEASES], 'release <line> <gate>'], [['answer', RELEASES, 'asker'], 'answer <line> <machine> <text>'], [['retry', RELEASES], 'retry <line> <machine>'], [['halt'], 'halt <line>'], [['resume'], 'resume <line>'], [['allow'], 'allow <request>'], [['deny'], 'deny <request>']] as const) {
        const r = await run(root, ...argv);
        expect(r.code, argv.join(' ')).toBe(1);
        expect(r.err).toContain(usage);
      }
    });

    it('needs --when-idle to restart', async () => {
      const root = await engine();
      expect((await run(root, 'restart')).err).toContain('restart --when-idle');
    });

    it('refuses to restart the engine while build mode holds a draft, which a restart would lose', async () => {
      const root = await engine();
      server!.service.buildStart('releases');
      const r = await run(root, 'restart', '--when-idle');
      expect(r.code).toBe(1);
      expect(r.err).toContain('draft');
    });

    it('stops the engine', async () => {
      const root = await engine();
      expect((await run(root, 'stop')).out).toBe('Engine stopped.\n');
      await until(() => !fs.existsSync(path.join(root, '.runs', 'engine.lock')));
      server = null;
    });
  });
});

/** Waits until `roboratory status` says something. */
async function statusSays(root: string, re: RegExp, ms = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test((await run(root, 'status')).out)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
