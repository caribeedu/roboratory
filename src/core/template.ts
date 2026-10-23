// {{...}} templates for signal commands and the simulated agent.
// Paths read from a context object: {{box.ticket}}, {{params.service}}, {{run.id}}.
// The simulated agent also gets helpers: {{pick a|b}}, {{int 1 9}}, {{num 0.5 0.9}}.

export type Ctx = Record<string, unknown>;

function lookup(ctx: Ctx, path: string): unknown {
  let cur: unknown = ctx;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function evalTag(tag: string, ctx: Ctx, rand: () => number): unknown {
  const [head, ...rest] = tag.trim().split(/\s+/);
  if (head === 'pick') { const opts = rest.join(' ').split('|'); return opts[Math.floor(rand() * opts.length)]; }
  if (head === 'int') { const [a, b] = rest.map(Number); return a + Math.floor(rand() * (b - a + 1)); }
  if (head === 'num') { const [a, b] = rest.map(Number); return Math.round((a + rand() * (b - a)) * 100) / 100; }
  const v = lookup(ctx, head);
  return v === undefined || v === null ? '' : v;
}

export function render(s: string, ctx: Ctx, rand: () => number = Math.random): unknown {
  const whole = /^\{\{([^}]+)\}\}$/.exec(s);
  if (whole) return evalTag(whole[1], ctx, rand);
  return s.replace(/\{\{([^}]+)\}\}/g, (_, t) => { const v = evalTag(t, ctx, rand); return typeof v === 'object' ? JSON.stringify(v) : String(v); });
}

export function renderDeep(v: unknown, ctx: Ctx, rand: () => number = Math.random): unknown {
  if (typeof v === 'string') return render(v, ctx, rand);
  if (Array.isArray(v)) return v.map((x) => renderDeep(x, ctx, rand));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, renderDeep(x, ctx, rand)]));
  return v;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Renders a shell command; every substituted value is shell-quoted. */
export function renderCommand(cmd: string, ctx: Ctx): string {
  return cmd.replace(/\{\{([^}]+)\}\}/g, (_, t) => {
    const v = lookup(ctx, t.trim());
    return shq(v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
}
