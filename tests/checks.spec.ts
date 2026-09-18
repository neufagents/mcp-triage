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

test('drift: same server name with different shapes across clients is info', () => {
  const a = wrap('cursor', [{ name: 'github', command: 'npx', args: ['-y', 'gh-v1'] }]);
  const b = wrap('codex', [{ name: 'github', command: 'npx', args: ['-y', 'gh-v2'] }]);
  const d = checkCrossClientDrift([a, b]);
  assert.equal(d.length, 1);
  assert.equal(d[0].checkId, 'config.cross-client-drift');
  assert.equal(d[0].severity, 'info');
});
