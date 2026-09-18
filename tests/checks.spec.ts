import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCrossClientDrift, resolveCommandOnPath, runChecks, type CheckContext } from '../src/checks.ts';
import type { ParsedConfig, ServerEntry } from '../src/types.ts';

const baseCtx = (over: Partial<CheckContext> = {}): CheckContext => ({ env: {}, platform: process.platform, ...over });

function wrap(clientId: string, servers: ServerEntry[]): ParsedConfig {
  return { clientId, file: `${clientId}.json`, format: 'json', ok: true, servers, diagnostics: [] };
}

test('resolveCommandOnPath: resolves a command from injected PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-path-'));
  const name = process.platform === 'win32' ? 'faketool.cmd' : 'faketool';
  const exe = path.join(dir, name);
  fs.writeFileSync(exe, '');
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  const ctx = baseCtx({ env: { PATH: dir, PATHEXT: '.CMD' } });
  assert.ok(resolveCommandOnPath('faketool', ctx));
});

test('resolveCommandOnPath: missing command returns null', () => {
  assert.equal(resolveCommandOnPath('no-such-cmd-xyz-123', baseCtx({ env: { PATH: '/nonexistent-dir' } })), null);
});

test('check: missing command+url is an error', () => {
  const d = runChecks([wrap('cursor', [{ name: 'bad' }])], baseCtx({ env: { PATH: '' } }));
  assert.equal(d[0].checkId, 'server.command-missing');
  assert.equal(d[0].severity, 'error');
});

test('check: unresolvable command is an error', () => {
  const d = runChecks([wrap('cursor', [{ name: 'ghost', command: 'no-such-cmd-xyz-123' }])], baseCtx({ env: { PATH: '/nonexistent-dir' } }));
  assert.ok(d.some((x) => x.checkId === 'server.command-unresolvable' && x.severity === 'error'));
});

test('check: missing env ref is a warning', () => {
  const d = runChecks([wrap('cursor', [{ name: 's', command: 'node', args: ['${DEFINITELY_MISSING_VAR}'] }])], baseCtx({ env: { PATH: '' } }));
  const envDiag = d.find((x) => x.checkId === 'server.env-ref-missing');
  assert.ok(envDiag);
  assert.equal(envDiag.severity, 'warning');
  assert.match(envDiag.title, /DEFINITELY_MISSING_VAR/);
});

test('check: insecure http url is a warning', () => {
  const d = runChecks([wrap('openclaw', [{ name: 'web', url: 'http://example.com/mcp' }])], baseCtx());
  assert.ok(d.some((x) => x.checkId === 'server.url-insecure'));
});

test('check: stdio transport without command is an error', () => {
  const d = runChecks([wrap('dsh', [{ name: 'gh', transport: 'stdio', url: 'http://x' }])], baseCtx({ env: { PATH: '' } }));
  assert.ok(d.some((x) => x.checkId === 'server.stdio-command-missing' && x.severity === 'error'));
});

test('check: http transport without url is an error', () => {
  const d = runChecks([wrap('openclaw', [{ name: 'docs', transport: 'streamable-http', command: 'node' }])], baseCtx({ env: { PATH: '' } }));
  assert.ok(d.some((x) => x.checkId === 'server.http-url-missing' && x.severity === 'error'));
});

test('check: unknown transport warns', () => {
  const d = runChecks([wrap('x', [{ name: 's', transport: 'grpc', command: 'node' }])], baseCtx({ env: { PATH: '' } }));
  assert.ok(d.some((x) => x.checkId === 'server.transport-unknown' && x.severity === 'warning'));
});

test('check: disabled server (enabled:false) skips runtime checks', () => {
  const d = runChecks(
    [wrap('openclaw', [{ name: 'lazy', command: 'no-such-cmd-xyz-123', enabled: false }])],
    baseCtx({ env: { PATH: '' } }),
  );
  assert.equal(d.length, 1);
  assert.equal(d[0].checkId, 'server.disabled');
});

test('check: process.env refs (dsh) are detected when the var is missing', () => {
  const d = runChecks(
    [wrap('dsh', [{ name: 'gh', command: 'npx', env: { GITHUB_TOKEN: 'process.env.DEFINITELY_MISSING_TOKEN' } }])],
    baseCtx({ env: { PATH: '' } }),
  );
  const envDiag = d.find((x) => x.checkId === 'server.env-ref-missing');
  assert.ok(envDiag);
  assert.match(envDiag.title, /DEFINITELY_MISSING_TOKEN/);
});

test('drift: same server name with different shapes across clients is info', () => {
  const a = wrap('cursor', [{ name: 'github', command: 'npx', args: ['-y', 'gh-v1'] }]);
  const b = wrap('codex', [{ name: 'github', command: 'npx', args: ['-y', 'gh-v2'] }]);
  const d = checkCrossClientDrift([a, b]);
  assert.equal(d.length, 1);
  assert.equal(d[0].checkId, 'config.cross-client-drift');
  assert.equal(d[0].severity, 'info');
});

test('drift: same name in two places of one client reports places and contexts', () => {
  const a: ServerEntry = { name: 'github', command: 'npx', args: ['-y', 'v1'], context: 'project: /p/a' };
  const b: ServerEntry = { name: 'github', command: 'npx', args: ['-y', 'v2'], context: 'project: /p/b' };
  const d = checkCrossClientDrift([wrap('claude-code', [a, b])]);
  assert.equal(d.length, 1);
  assert.match(d[0].title, /configured differently in 2 places/);
  assert.match(d[0].detail ?? '', /project: \/p\/a/);
});

test('check: entry context is carried into diagnostics', () => {
  const d = runChecks(
    [wrap('claude-code', [{ name: 'ghost', command: 'no-such-cmd-xyz-123', context: 'project: /p/a' }])],
    baseCtx({ env: { PATH: '/nonexistent-dir' } }),
  );
  const f = d.find((x) => x.checkId === 'server.command-unresolvable');
  assert.ok(f);
  assert.equal(f.context, 'project: /p/a');
});
