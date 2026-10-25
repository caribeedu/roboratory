// The core file formats (D46): `line.yaml` and `machine.yaml` are described by the JSON Schemas in `schemas/`, which the
// loader checks every file against, so build mode (whose drafts load through the same loader) and any editor that reads
// the schemas agree with it. A key the schema does not know is an error, and the version of the format is required.
import Ajv, { type ErrorObject } from 'ajv';
import lineSchema from '../../schemas/line.schema.json';
import machineSchema from '../../schemas/machine.schema.json';

/** The version of the formats, which has nothing to do with the version of the product. */
export const SCHEMA_VERSION = 1;

const ajv = new Ajv({ allErrors: true, verbose: true, strict: false });
const validators = { line: ajv.compile(lineSchema), machine: ajv.compile(machineSchema) };

export type FormatKind = keyof typeof validators;

/** `pieces/2/gate` as `pieces[2].gate`, and the root as the file itself. */
function where(path: string): string {
  if (!path) return 'the file';
  return path.slice(1).split('/').map((p, i) => (/^\d+$/.test(p) ? `[${p}]` : `${i ? '.' : ''}${p}`)).join('');
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function say(e: ErrorObject): string {
  const at = where(e.instancePath);
  if (e.keyword === 'additionalProperties') {
    const key = String(e.params.additionalProperty);
    const known = Object.keys((e.parentSchema as { properties?: object } | undefined)?.properties ?? {});
    const near = known.find((k) => distance(k, key) <= 2 && Math.abs(k.length - key.length) <= 2);
    return `unknown key "${key}" in ${at}${near ? ` (did you mean "${near}"?)` : ''}. Known keys: ${known.join(', ')}`;
  }
  if (e.keyword === 'required') return `${at} needs "${e.params.missingProperty}"`;
  if (e.keyword === 'const' || e.keyword === 'enum') {
    const allowed = (e.params as { allowedValues?: unknown[]; allowedValue?: unknown }).allowedValues ?? [(e.params as { allowedValue?: unknown }).allowedValue];
    return `${at} must be ${allowed.map(String).join(' or ')}`;
  }
  if (e.keyword === 'type') return `${at} must be ${[e.params.type].flat().join(' or ')}`;
  return `${at} ${e.message}`;
}

/**
 * What is wrong with a parsed `line.yaml` or `machine.yaml`, as sentences that name the key; empty when it is fine. A file
 * without `schema_version`, or with one this app does not read, says what to write; the older `Bash(...)` form of a
 * command says the prefix to write instead.
 */
export function checkFormat(kind: FormatKind, doc: unknown): string[] {
  const out: string[] = [];
  const v = (doc as { schema_version?: unknown } | null)?.schema_version;
  if (v === undefined) out.push(`schema_version is missing: write "schema_version: ${SCHEMA_VERSION}" at the top of the file (the version of the format; see docs/FORMATS.md)`);
  else if (v !== SCHEMA_VERSION) out.push(`schema_version ${JSON.stringify(v)} is not one this app reads (it reads ${SCHEMA_VERSION})`);
  const validate = validators[kind];
  if (!validate(doc)) for (const e of validate.errors ?? []) if (!(e.keyword === 'required' && e.params.missingProperty === 'schema_version') && e.instancePath !== '/schema_version') out.push(say(e));
  const lists = kind === 'machine' ? ['allow', 'deny'] : ['deny'];
  for (const key of lists) {
    const list = (doc as Record<string, unknown> | null)?.[key];
    if (Array.isArray(list)) for (const entry of list) {
      const m = typeof entry === 'string' ? /^Bash\((.*?)(?::\*)?\)$/.exec(entry.trim()) : null;
      if (m) out.push(`${key}: "${entry}" is the older form; write the command as a prefix: "${m[1].trim()}"`);
    }
  }
  return out;
}
