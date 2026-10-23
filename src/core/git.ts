// Git helpers. Promptory never writes to the factory repository's git (D5);
// it only reads it. Target repositories get chained per-machine worktrees (D10).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const IDENTITY = { GIT_AUTHOR_NAME: 'Promptory', GIT_AUTHOR_EMAIL: 'machine@promptory.local', GIT_COMMITTER_NAME: 'Promptory', GIT_COMMITTER_EMAIL: 'machine@promptory.local' };

export function git(cwd: string, args: string[], opts: { allowFail?: boolean } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: { ...process.env, ...IDENTITY }, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? (error as unknown as { code: number }).code : 1) : 0;
      if (error && !opts.allowFail) reject(new Error(`git ${args.join(' ')}: ${stderr.trim() || error.message}`));
      else resolve({ code, out: stdout, err: stderr });
    });
  });
}

export async function isRepo(dir: string) {
  if (!fs.existsSync(dir)) return false;
  const r = await git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  return r.code === 0 && r.out.trim() === 'true';
}

/** The factory version a run used: base commit plus any uncommitted diff. */
export async function factoryVersion(root: string): Promise<{ commit?: string; diff?: string }> {
  if (!(await isRepo(root))) return {};
  const head = await git(root, ['rev-parse', 'HEAD'], { allowFail: true });
  const diff = await git(root, ['diff', 'HEAD', '--', '.', ':(exclude).runs'], { allowFail: true });
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard'], { allowFail: true });
  const extra = untracked.out.trim() ? `\n# untracked files\n${untracked.out}` : '';
  return { commit: head.code === 0 ? head.out.trim() : undefined, diff: (diff.out + extra).trim() || undefined };
}

export async function headOf(repo: string, ref = 'HEAD') {
  return (await git(repo, ['rev-parse', ref])).out.trim();
}

export async function addWorktree(repo: string, dir: string, branch: string, base: string) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(repo, ['worktree', 'add', '-q', '-B', branch, dir, base]);
}

/** Safety net: commits whatever the agent left uncommitted. Returns the new HEAD. */
export async function commitLeftovers(worktree: string, message: string): Promise<{ committed: boolean; head: string }> {
  const st = await git(worktree, ['status', '--porcelain']);
  let committed = false;
  if (st.out.trim()) {
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-q', '-m', message]);
    committed = true;
  }
  return { committed, head: await headOf(worktree) };
}

export async function mergeInto(worktree: string, branch: string): Promise<{ ok: boolean; conflict?: string }> {
  const r = await git(worktree, ['merge', '--no-edit', '-q', branch], { allowFail: true });
  if (r.code === 0) return { ok: true };
  const files = await git(worktree, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true });
  await git(worktree, ['merge', '--abort'], { allowFail: true });
  return { ok: false, conflict: `merge conflict with ${branch} in: ${files.out.trim().split('\n').join(', ') || r.err.trim()}` };
}

export async function removeWorktree(repo: string, dir: string) {
  await git(repo, ['worktree', 'remove', '--force', dir], { allowFail: true });
}

/** Read-only view of the factory repository for the Blueprint-free MVP. */
export async function log(root: string, n = 20) {
  if (!(await isRepo(root))) return [];
  const r = await git(root, ['log', `-${n}`, '--pretty=%H%x09%ad%x09%s', '--date=iso'], { allowFail: true });
  return r.out.trim() ? r.out.trim().split('\n').map((l) => { const [hash, date, subject] = l.split('\t'); return { hash, date, subject }; }) : [];
}
