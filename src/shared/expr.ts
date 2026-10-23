// A tiny, safe expression language for rule gates and splitter belts.
// Grammar: or := and ('||' and)* ; and := not ('&&' not)* ; not := '!' not | cmp
// cmp := value (op value | 'in' list)? ; value := literal | path | '(' or ')'
// Nothing is ever executed: expressions only read fields of the box.

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'punc'; v: string };

type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'path'; v: string[] }
  | { k: 'list'; v: Node[] }
  | { k: 'not'; v: Node }
  | { k: 'bin'; op: string; l: Node; r: Node };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error(`Unterminated string starting at ${i + 1}`);
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1; continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num && (c !== '-' || out.length === 0 || out[out.length - 1].t === 'op' || out[out.length - 1].v === '(' || out[out.length - 1].v === '[' || out[out.length - 1].v === ',')) {
      out.push({ t: 'num', v: num[0] }); i += num[0].length; continue;
    }
    const op = /^(==|!=|>=|<=|&&|\|\||>|<|!)/.exec(src.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    if ('()[],'.includes(c)) { out.push({ t: 'punc', v: c }); i++; continue; }
    const id = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    throw new Error(`Unexpected character "${c}" at ${i + 1}`);
  }
  return out;
}

export function parseExpr(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const take = (v?: string) => {
    const t = toks[p];
    if (!t || (v && t.v !== v)) throw new Error(v ? `Expected "${v}"` : 'Expected a value at the end');
    p++; return t;
  };
  const value = (): Node => {
    const t = peek();
    if (!t) throw new Error('Expected a value at the end');
    if (t.v === '(') { take('('); const n = or(); take(')'); return n; }
    if (t.t === 'num') { p++; return { k: 'lit', v: Number(t.v) }; }
    if (t.t === 'str') { p++; return { k: 'lit', v: t.v }; }
    if (t.t === 'id') {
      p++;
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (peek()?.v === '(') throw new Error(`Function calls are not allowed ("${t.v}(")`);
      return { k: 'path', v: t.v.split('.') };
    }
    if (t.v === '[') {
      take('['); const items: Node[] = [];
      while (peek() && peek().v !== ']') { items.push(value()); if (peek()?.v === ',') take(','); }
      take(']'); return { k: 'list', v: items };
    }
    throw new Error(`Expected a value, found "${t.v}"`);
  };
  const cmp = (): Node => {
    const l = value();
    const t = peek();
    if (t && t.t === 'op' && ['==', '!=', '>=', '<=', '>', '<'].includes(t.v)) { p++; return { k: 'bin', op: t.v, l, r: value() }; }
    if (t && t.t === 'id' && t.v === 'in') { p++; return { k: 'bin', op: 'in', l, r: value() }; }
    return l;
  };
  const not = (): Node => (peek()?.v === '!' ? (take('!'), { k: 'not', v: not() }) : cmp());
  const and = (): Node => { let n = not(); while (peek()?.v === '&&') { take(); n = { k: 'bin', op: '&&', l: n, r: not() }; } return n; };
  const or = (): Node => { let n = and(); while (peek()?.v === '||') { take(); n = { k: 'bin', op: '||', l: n, r: and() }; } return n; };
  if (!toks.length) throw new Error('Empty expression');
  const n = or();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return n;
}

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur === undefined ? null : cur;
}

function ev(n: Node, ctx: unknown): unknown {
  switch (n.k) {
    case 'lit': return n.v;
    case 'path': return get(ctx, n.v);
    case 'list': return n.v.map((x) => ev(x, ctx));
    case 'not': return !truthy(ev(n.v, ctx));
    case 'bin': {
      if (n.op === '&&') return truthy(ev(n.l, ctx)) && truthy(ev(n.r, ctx));
      if (n.op === '||') return truthy(ev(n.l, ctx)) || truthy(ev(n.r, ctx));
      const l = ev(n.l, ctx), r = ev(n.r, ctx);
      switch (n.op) {
        case '==': return l === r;
        case '!=': return l !== r;
        case '>': return typeof l === typeof r && (l as number) > (r as number);
        case '<': return typeof l === typeof r && (l as number) < (r as number);
        case '>=': return typeof l === typeof r && (l as number) >= (r as number);
        case '<=': return typeof l === typeof r && (l as number) <= (r as number);
        case 'in': return Array.isArray(r) && r.includes(l);
      }
    }
  }
  return null;
}

const truthy = (v: unknown) => v !== null && v !== false && v !== 0 && v !== '';

export function evaluate(src: string, box: unknown): boolean {
  return truthy(ev(parseExpr(src), box));
}

/** The fields a rule reads, the literal values each is compared against, and the operators used on it. */
export function ruleFields(src: string): { path: string[]; values: unknown[]; ops: string[] }[] {
  const out = new Map<string, { path: string[]; values: unknown[]; ops: string[] }>();
  const add = (p: string[], vals: unknown[] = [], op = 'read') => { const k = p.join('.'); const f = out.get(k) ?? { path: p, values: [], ops: [] }; f.values.push(...vals); if (!f.ops.includes(op)) f.ops.push(op); out.set(k, f); };
  const lits = (n: Node): unknown[] => (n.k === 'lit' ? [n.v] : n.k === 'list' ? n.v.flatMap(lits) : []);
  // under a `!`, every comparison is inverted, so it is recorded as '!' (it may take any value)
  const walk = (n: Node, neg = false) => {
    const op = (o: string) => (neg ? '!' : o);
    if (n.k === 'path') add(n.v, [], op('read'));
    else if (n.k === 'list') n.v.forEach((x) => walk(x, neg));
    else if (n.k === 'not') walk(n.v, !neg);
    else if (n.k === 'bin') {
      if (n.l.k === 'path' && n.op !== '&&' && n.op !== '||') { add(n.l.v, lits(n.r), op(n.op)); if (n.r.k !== 'lit' && n.r.k !== 'list') walk(n.r, neg); }
      else if (n.r.k === 'path' && n.op !== '&&' && n.op !== '||') { add(n.r.v, lits(n.l), op(n.op)); walk(n.l, neg); }
      else { walk(n.l, neg); walk(n.r, neg); }
    }
  };
  walk(parseExpr(src));
  return [...out.values()];
}

// ---------- plain-language rules for the UI ----------

// the field a rule reads is marked too, so the UI can show what is being compared
const humanPath = (p: string[]) => `the \u0003${p.join(' ').replace(/_/g, ' ')}\u0004`;
// values compared against are marked so the UI can style them apart from the sentence
const V = (s: string) => `\u0001${s}\u0002`;
const lit = (n: Node): string => (n.k === 'lit' ? V(String(n.v)) : n.k === 'list' ? n.v.map(lit).join(' or ') : n.k === 'path' ? humanPath(n.v) : '…');
const isChoice = (n: Node) => n.k === 'path' && n.v.join('.') === 'decision.choice';

function say(n: Node): string {
  switch (n.k) {
    case 'lit': return V(String(n.v));
    case 'list': return lit(n);
    case 'path': return `${humanPath(n.v)} is set`;
    case 'not': return `not (${say(n.v)})`;
    case 'bin': {
      if (n.op === '||') {
        const l = n.l, r = n.r;
        if (l.k === 'bin' && r.k === 'bin' && l.op === '==' && r.op === '==' && isChoice(l.l) && isChoice(r.l)) return `you choose to ${lit(l.r)} or ${lit(r.r)}`;
        if (r.k === 'bin' && r.op === '==' && isChoice(r.l) && /^you choose to /.test(say(l))) return `${say(l)} or ${lit(r.r)}`;
        return `${say(l)} or ${say(r)}`;
      }
      if (n.op === '&&') return `${say(n.l)} and ${say(n.r)}`;
      if (isChoice(n.l) && n.op === '==') return `you choose to ${lit(n.r)}`;
      if (isChoice(n.l) && n.op === '!=') return `you choose anything but ${lit(n.r)}`;
      const subject = n.l.k === 'path' ? humanPath(n.l.v) : lit(n.l);
      const verb = { '==': 'is', '!=': 'is not', '>=': 'is at least', '<=': 'is at most', '>': 'is more than', '<': 'is less than', in: 'is' }[n.op] ?? n.op;
      return `${subject} ${verb} ${lit(n.r)}`;
    }
  }
}

/** A rule in words, as parts: plain text and the values it compares against. */
export function describeParts(src: string): { text: string; value?: boolean; field?: boolean }[] {
  let s: string;
  try { s = say(parseExpr(src)); } catch { return [{ text: src }]; }
  return s.split(/(\u0001[^\u0002]*\u0002|\u0003[^\u0004]*\u0004)/).filter(Boolean).map((p) => (
    p.startsWith('\u0001') ? { text: p.slice(1, -1), value: true } : p.startsWith('\u0003') ? { text: p.slice(1, -1), field: true } : { text: p }));
}

/** A rule in words, for people: "verdict == 'pass'" → "the verdict is pass". */
export function describe(src: string): string {
  return describeParts(src).map((p) => p.text).join('');
}
