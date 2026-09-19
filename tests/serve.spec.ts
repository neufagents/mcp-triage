import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { handleMessage, TOOLS } from '../src/serve.ts';

const tmpfile = (name: string, content: string): { dir: string; file: string } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-serve-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return { dir, file };
};

// Trailing comma: fails strict JSON; parses under the JSON5-light fallback (unattributed files → info, not error).
const TRAILING_COMMA = '{\n  "mcpServers": {\n    "a": { "command": "npx" },\n  }\n}';
// Missing comma: fails strict JSON AND JSON5-light — the genuine syntax-error path.
const MISSING_COMMA = '{\n  "mcpServers": {\n    "a": { "command": "npx" }\n    "b": { "command": "uvx" }\n  }\n}';

const HELLO = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
};

// ---------- protocol ----------

test('serve: initialize echoes a supported protocol version and declares tools', async () => {
  const res = await handleMessage(HELLO);
  assert.ok(res);
  const r = res!.result as any;
  assert.equal(r.protocolVersion, '2025-06-18');
  assert.equal(r.serverInfo.name, 'mcp-triage');
  assert.ok(r.capabilities.tools);
  assert.ok(typeof r.instructions === 'string' && r.instructions.length > 0);
});

test('serve: initialize echoes older supported revisions', async () => {
  const res = await handleMessage({ ...HELLO, params: { protocolVersion: '2024-11-05' } });
  assert.equal((res!.result as any).protocolVersion, '2024-11-05');
});

test('serve: initialize counter-offers the newest supported revision for unknown versions', async () => {
  const res = await handleMessage({ ...HELLO, params: { protocolVersion: '2030-01-01' } });
  assert.equal((res!.result as any).protocolVersion, '2025-06-18');
});

test('serve: ping answers an empty result', async () => {
  const res = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' });
  assert.deepEqual(res, { jsonrpc: '2.0', id: 2, result: {} });
});

test('serve: tools/list exposes triage_scan (read-only) and triage_fix', async () => {
  const res = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const tools = (res!.result as any).tools as any[];
  assert.equal(tools.length, 2);
  assert.deepEqual(tools.map((t) => t.name), ['triage_scan', 'triage_fix']);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[1].annotations.readOnlyHint, false);
  assert.ok(tools.every((t) => t.inputSchema && t.description));
  assert.equal(TOOLS.length, 2);
});

test('serve: unknown tool yields an invalid-params error', async () => {
  const res = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(res!.error?.code, -32602);
});

test('serve: unknown request method yields method-not-found; notifications are ignored', async () => {
  const req = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'workspace/foo' });
  assert.equal(req!.error?.code, -32601);
  const note = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note, null);
  const note2 = await handleMessage({ jsonrpc: '2.0', method: 'anything/at-all' });
  assert.equal(note2, null);
});

test('serve: request methods sent without an id (notifications) get no response', async () => {
  // JSON-RPC 2.0 / MCP: notifications are one-way — the receiver MUST NOT send a response.
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'ping' }), null);
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'tools/list' }), null);
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'triage_scan' } }), null);
});

test('serve: invalid request shapes yield -32600; empty lists are served defensively', async () => {
  const bad = await handleMessage([1, 2, 3]);
  assert.equal(bad!.error?.code, -32600);
  const res = await handleMessage({ jsonrpc: '2.0', id: 6, method: 'resources/list' });
  assert.deepEqual(res!.result, { resources: [] });
});

// ---------- tools ----------

test('serve: triage_scan reports a syntax error for a file that fails lenient parsing too', async () => {
  const { file } = tmpfile('mcp.json', MISSING_COMMA);
  const res = await handleMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'triage_scan', arguments: { file } } });
  const r = res!.result as any;
  assert.equal(r.isError, false);
  const text = r.content[0].text as string;
  assert.match(text, /\[ERROR\] config\.syntax/);
  assert.match(text, /mcp\.json/);
  assert.equal(fs.readFileSync(file, 'utf8'), MISSING_COMMA); // read-only
});

test('serve: triage_scan treats a strict-JSON-only file as info (documented lenient behavior)', async () => {
  const { file } = tmpfile('mcp.json', TRAILING_COMMA);
  const res = await handleMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'triage_scan', arguments: { file } } });
  const text = (res!.result as any).content[0].text as string;
  assert.match(text, /\[INFO *\] config\.json5-only/);
  assert.match(text, /json5-light/);
});

test('serve: triage_fix defaults to dry-run — reports, writes nothing', async () => {
  const { file } = tmpfile('mcp.json', MISSING_COMMA);
  const res = await handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'triage_fix', arguments: { file } } });
  const text = (res!.result as any).content[0].text as string;
  assert.match(text, /\[NOFIX\]/);
  assert.equal(fs.readFileSync(file, 'utf8'), MISSING_COMMA);
  assert.equal(fs.existsSync(file + '.mcp-triage.bak'), false);
});

test('serve: triage_fix with dry_run:false still writes nothing when no mechanical repair applies', async () => {
  const { file } = tmpfile('mcp.json', MISSING_COMMA);
  const res = await handleMessage({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name: 'triage_fix', arguments: { file, dry_run: false } },
  });
  const text = (res!.result as any).content[0].text as string;
  assert.match(text, /\[NOFIX\]/);
  assert.equal(fs.readFileSync(file, 'utf8'), MISSING_COMMA);
  assert.equal(fs.existsSync(file + '.mcp-triage.bak'), false);
});

// ---------- CLI end-to-end over stdio ----------

function startServer(env?: Record<string, string>): { child: ReturnType<typeof spawn>; next: () => Promise<any> } {
  const child = spawn(process.execPath, ['src/cli.ts', 'serve'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  child.stderr.on('data', () => {});
  const lines: string[] = [];
  let buf = '';
  child.stdout!.on('data', (d: Buffer) => {
    buf += d.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) lines.push(line);
    }
  });
  const next = async (): Promise<any> => {
    const deadline = Date.now() + 15000;
    while (lines.length === 0) {
      if (Date.now() > deadline) throw new Error('timeout waiting for server output');
      await new Promise((r) => setTimeout(r, 25));
    }
    return JSON.parse(lines.shift()!);
  };
  return { child, next };
}

async function close(child: ReturnType<typeof spawn>): Promise<number | null> {
  child.stdin!.end();
  return new Promise<number | null>((resolve) => child.on('exit', resolve));
}

test('serve: CLI end-to-end — initialize, tools/list over stdio, clean exit on stdin close', async () => {
  const { child, next } = startServer();
  try {
    child.stdin!.write(JSON.stringify(HELLO) + '\n');
    const init = await next();
    assert.equal(init.result.serverInfo.name, 'mcp-triage');

    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    const tl = await next();
    assert.equal(tl.id, 2);
    assert.equal(tl.result.tools.length, 2);

    assert.equal(await close(child), 0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

test('serve: triage_fix end-to-end on a fake home — repairs a strict client config, keeps a backup', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-fakehome-'));
  const appdata = path.join(home, 'AppData', 'Roaming');
  const cfgDir = path.join(appdata, 'Claude');
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfg = path.join(cfgDir, 'claude_desktop_config.json');
  fs.writeFileSync(cfg, TRAILING_COMMA);

  const { child, next } = startServer({ USERPROFILE: home, APPDATA: appdata, HOME: home, OPENCLAW_CONFIG_PATH: '' });
  try {
    child.stdin!.write(JSON.stringify(HELLO) + '\n');
    await next();
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    // scan first: the strict client rejects the trailing comma (error, not info)
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'triage_scan' } }) + '\n');
    const scan = await next();
    const scanText = scan.result.content[0].text as string;
    assert.match(scanText, /\[ERROR\] config\.syntax/);
    assert.match(scanText, /Claude Desktop/);

    // fix for real: FIXED + backup + file parses now
    child.stdin!.write(
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'triage_fix', arguments: { dry_run: false } } }) + '\n',
    );
    const fix = await next();
    const fixText = fix.result.content[0].text as string;
    assert.match(fixText, /\[FIXED\]/);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(cfg, 'utf8')));
    assert.equal(fs.readFileSync(cfg + '.mcp-triage.bak', 'utf8'), TRAILING_COMMA);

    assert.equal(await close(child), 0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

test('serve: scan CLI still works after the serve refactor (--version and single-file scan)', async () => {
  const v = spawn(process.execPath, ['src/cli.ts', '--version'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let vout = '';
  v.stdout!.on('data', (d: Buffer) => (vout += d.toString()));
  const vcode = await new Promise<number | null>((resolve) => v.on('exit', resolve));
  assert.equal(vcode, 0);
  assert.match(vout, /^\d+\.\d+\.\d+/);

  const { file } = tmpfile('mcp.json', MISSING_COMMA);
  const s = spawn(process.execPath, ['src/cli.ts', '--file', file, '--json'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let sout = '';
  s.stdout!.on('data', (d: Buffer) => (sout += d.toString()));
  const scode = await new Promise<number | null>((resolve) => s.on('exit', resolve));
  assert.equal(scode, 1); // error finding
  const parsed = JSON.parse(sout);
  assert.equal(parsed.tool, 'mcp-triage');
  assert.ok(parsed.diagnostics.some((d: any) => d.checkId === 'config.syntax'));
});
