import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLIENTS, expandPlaceholders, type PathContext } from '../src/clients.ts';
import { discoverFiles, expandGlob } from '../src/discover.ts';

test('registry: 8 clients with unique ids and valid formats', () => {
  assert.equal(CLIENTS.length, 8);
  const ids = new Set(CLIENTS.map((c) => c.id));
  assert.equal(ids.size, 8);
  for (const c of CLIENTS) {
    assert.ok(['json', 'toml', 'yaml'].includes(c.format), c.id);
    const n =
      (c.paths.any?.length ?? 0) + (c.paths.win32?.length ?? 0) + (c.paths.darwin?.length ?? 0) + (c.paths.linux?.length ?? 0);
    assert.ok(n > 0, c.id);
  }
});

test('expandPlaceholders replaces <home>/<appdata>/<config>', () => {
  const ctx: PathContext = { platform: 'linux', home: '/h', appdata: '/a', configDir: '/c' };
  assert.equal(expandPlaceholders('<home>/x', ctx), '/h/x');
  assert.equal(expandPlaceholders('<appdata>/y', ctx), '/a/y');
  assert.equal(expandPlaceholders('<config>/z', ctx), '/c/z');
});

test('discoverFiles finds fixture configs under a fake home', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-home-'));
  const home = path.join(tmp, 'home');
  const mk = (p: string, content = '{}') => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  mk(path.join(home, '.cursor', 'mcp.json'));
  mk(path.join(home, '.codex', 'config.toml'));
  mk(path.join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml'), '[]');
  const cwd = path.join(tmp, 'proj');
  mk(path.join(cwd, '.mcp.json'));
  const ctx: PathContext = { platform: 'linux', home, appdata: path.join(home, '.appdata'), configDir: path.join(home, '.config') };
  const found = discoverFiles(cwd, ctx);
  const ids = found.map((f) => f.clientId);
  assert.ok(ids.includes('cursor'));
  assert.ok(ids.includes('codex'));
  assert.ok(ids.includes('dsh'));
  assert.ok(ids.includes('claude-code'));
  const keys = found.map((f) => f.file.toLowerCase());
  assert.equal(new Set(keys).size, keys.length, 'no duplicate files');
});

test('expandGlob handles single-star segments', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-glob-'));
  fs.mkdirSync(path.join(tmp, 'a'));
  fs.writeFileSync(path.join(tmp, 'a', 'x.yml'), 'a: 1');
  fs.mkdirSync(path.join(tmp, 'b'));
  const out = expandGlob(tmp.replace(/\\/g, '/') + '/*/x.yml');
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith('x.yml'));
});

test('registry: vscode remote path, openclaw json5 + env override are declared', () => {
  const vscode = CLIENTS.find((c) => c.id === 'vscode')!;
  assert.ok(vscode.paths.linux?.some((p) => p.includes('.vscode-server')));
  assert.ok(vscode.paths.darwin?.some((p) => p.includes('.vscode-server')));
  const openclaw = CLIENTS.find((c) => c.id === 'openclaw')!;
  assert.equal(openclaw.json5, true);
  assert.equal(openclaw.envOverride, 'OPENCLAW_CONFIG_PATH');
});

test('discoverFiles honors OPENCLAW_CONFIG_PATH override', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-oc-'));
  const cfg = path.join(tmp, 'custom-openclaw.json');
  fs.writeFileSync(cfg, '{}');
  const ctx: PathContext = {
    platform: 'linux',
    home: path.join(tmp, 'home'),
    appdata: path.join(tmp, 'appdata'),
    configDir: path.join(tmp, '.config'),
    env: { OPENCLAW_CONFIG_PATH: cfg },
  };
  const found = discoverFiles(path.join(tmp, 'proj'), ctx);
  const hit = found.find((f) => f.clientId === 'openclaw');
  assert.ok(hit, 'openclaw file from env override should be discovered');
  assert.equal(hit!.file, path.resolve(cfg));
  assert.equal(hit!.json5, true);
});
