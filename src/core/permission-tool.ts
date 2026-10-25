// The permission tool an agent's CLI starts (D44), as `roboratory permission-tool`. It speaks MCP over standard input
// and output, serves one tool, `approve`, and runs nothing: each call it receives is passed to the engine over its
// socket, and the engine's answer, which may wait for a person for as long as it takes, is passed back.
import readline from 'node:readline';
import type { Readable } from 'node:stream';
import { EngineClient } from './client';
import type { PermissionDecision } from './agents';

export const TOOL_NAME = 'approve';

const TOOL = {
  name: TOOL_NAME,
  description: 'Decides whether a tool call may run. Roboratory answers for the machine; a person may be asked.',
  inputSchema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name', 'input'],
  },
};

export async function runPermissionTool(o: { root: string; session: string; input?: Readable; output?: { write(s: string): unknown } }): Promise<void> {
  const out = o.output ?? process.stdout;
  const send = (m: object): void => { out.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'); };
  let engine: Promise<EngineClient> | undefined;
  const connect = () => (engine ??= EngineClient.connect(o.root, { client: 'permission-tool', reconnectTries: 0 }));

  async function decide(args: { tool_name?: unknown; input?: unknown }): Promise<PermissionDecision> {
    try {
      const c = await connect();
      return await c.call<PermissionDecision>('permission', o.session, { tool: String(args.tool_name ?? ''), input: (args.input as Record<string, unknown>) ?? {} });
    } catch (e) {
      return { behavior: 'deny', message: `Roboratory's engine could not be reached (${(e as Error).message}), so the call was not made. Answer blocked if you cannot go on without it.` };
    }
  }

  const pending = new Set<Promise<void>>();
  const rl = readline.createInterface({ input: o.input ?? process.stdin });
  rl.on('line', (line) => {
    let m: { id?: number | string; method?: string; params?: { protocolVersion?: string; arguments?: Record<string, unknown> } };
    try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return; // a notification needs no reply
    if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'roboratory', version: '1' } } });
    else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [TOOL] } });
    else if (m.method === 'tools/call') {
      const id = m.id;
      const job = decide(m.params?.arguments ?? {}).then((d) => send({ id, result: { content: [{ type: 'text', text: JSON.stringify(d) }] } })).finally(() => pending.delete(job));
      pending.add(job);
    } else if (m.method === 'ping') send({ id: m.id, result: {} });
    else send({ id: m.id, error: { code: -32601, message: `Unknown method ${m.method}` } });
  });
  await new Promise<void>((resolve) => rl.once('close', resolve));
  await Promise.allSettled([...pending]);
  if (engine) (await engine.catch(() => undefined))?.close();
}
