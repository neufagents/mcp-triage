import test from 'node:test';
import assert from 'node:assert/strict';
import { extractServersFromJson, findTrailingComma, parseJsonConfig, parseTomlConfig, parseYamlLight } from '../src/parse.ts';

test('json: valid config extracts servers (mcpServers)', () => {
  const text = JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } } } }, null, 2);
  const r = parseJsonConfig(text, 'x.json', 'cursor');
  assert.equal(r.ok, true);
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].command, 'npx');
  assert.deepEqual(r.servers[0].env, { A: '1' });
});

test('json: trailing comma is diagnosed', () => {
  const text = '{\n  "mcpServers": {\n    "a": { "command": "npx" },\n  }\n}';
  const r = parseJsonConfig(text, 'x.json', 'cursor');
  assert.equal(r.ok, false);
  const d = r.diagnostics[0];
  assert.equal(d.checkId, 'config.syntax');
  assert.match(d.title, /Trailing comma/);
});

test('json: unknown client (--file) JSON5-only file gets an info, not an error', () => {
  const text = '{\n  "mcpServers": {\n    "a": { "command": "npx" },\n  }\n}';
  const r = parseJsonConfig(text, 'x.json', 'custom', { json5Fallback: true });
  assert.equal(r.ok, true);
  assert.equal(r.diagnostics.length, 1);
  assert.equal(r.diagnostics[0].checkId, 'config.json5-only');
  assert.equal(r.diagnostics[0].severity, 'info');
});

test('json: vs code "servers" shape and openclaw mcp.servers shape', () => {
  const a = extractServersFromJson({ servers: { s1: { command: 'node' } } });
  assert.equal(a.length, 1);
  const b = extractServersFromJson({ mcp: { servers: { s2: { url: 'https://x' } } } });
  assert.equal(b.length, 1);
});

test('json5-light: comments + trailing commas accepted when json5 flag is on (OpenClaw)', () => {
  const text = [
    '{',
    '  // managed by OpenClaw',
    '  "mcp": {',
    '    "servers": {',
    '      "docs": { "url": "https://mcp.example.com/mcp", },',
    '    },',
    '  },',
    '}',
  ].join('\n');
  const strict = parseJsonConfig(text, 'openclaw.json', 'openclaw');
  assert.equal(strict.ok, false, 'strict JSON should reject it');
  const r = parseJsonConfig(text, 'openclaw.json', 'openclaw', { json5: true });
  assert.equal(r.ok, true);
  assert.equal(r.caveat, 'json5-light');
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].name, 'docs');
});

test('json5-light: single-quoted strings are converted', () => {
  const text = "{\n  'servers': { 'a': { 'command': 'npx', 'args': ['-y', 'pkg'] } }\n}";
  const r = parseJsonConfig(text, 'openclaw.json', 'openclaw', { json5: true });
  assert.equal(r.ok, true);
  assert.equal(r.servers[0].name, 'a');
  assert.equal(r.servers[0].command, 'npx');
});

test('json5-light: torture — unquoted keys, single quotes, comments, trailing commas, URLs in strings', () => {
  const text = [
    '{',
    '  // OpenClaw-style config',
    '  mcp: {',
    '    /* block comment */',
    '    servers: {',
    "      docs: { url: 'https://mcp.example.com/mcp', transport: 'streamable-http', },",
    "      local: { command: 'node', env: { BASE: 'http://internal:8080/path' } },",
    '    },',
    '  },',
    '}',
  ].join('\n');
  const r = parseJsonConfig(text, 'openclaw.json', 'openclaw', { json5: true });
  assert.equal(r.ok, true);
  assert.equal(r.servers.length, 2);
  const docs = r.servers.find((s) => s.name === 'docs')!;
  assert.equal(docs.url, 'https://mcp.example.com/mcp');
  assert.equal(docs.transport, 'streamable-http');
  const local = r.servers.find((s) => s.name === 'local')!;
  assert.equal(local.env?.BASE, 'http://internal:8080/path');
});

test('json: vscode "type" maps to transport; enabled:false is preserved', () => {
  const a = extractServersFromJson({ servers: { c7: { type: 'http', url: 'https://x/mcp' } } });
  assert.equal(a[0].transport, 'http');
  const b = extractServersFromJson({ mcp: { servers: { lazy: { command: 'x', enabled: false } } } });
  assert.equal(b[0].enabled, false);
});

test('toml: codex mcp_servers tables', () => {
  const text = [
    'model = "gpt-5"',
    '[mcp_servers.node_repl]',
    'command = "node"',
    'args = ["--experimental-repl", "repl.js"]',
    '[mcp_servers.node_repl.env]',
    'FOO = "bar"',
  ].join('\n');
  const r = parseTomlConfig(text, 'config.toml', 'codex');
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].name, 'node_repl');
  assert.equal(r.servers[0].command, 'node');
  assert.deepEqual(r.servers[0].args, ['--experimental-repl', 'repl.js']);
  assert.deepEqual(r.servers[0].env, { FOO: 'bar' });
});

test('yaml-light: dsh mcp-client plugin entry (block args parsed)', () => {
  const text = [
    '- id: mcp-github',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: github',
    '    transport: stdio',
    '    command: npx',
    '    args:',
    "      - '-y'",
    "      - '@modelcontextprotocol/server-github'",
  ].join('\n');
  const r = parseYamlLight(text, 'cordis.patch.yml', 'dsh');
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].name, 'github');
  assert.equal(r.servers[0].command, 'npx');
  assert.deepEqual(r.servers[0].args, ['-y', '@modelcontextprotocol/server-github']);
});

test('yaml-light: dsh entry with env block, !!js cast, cwd', () => {
  const text = [
    '- id: mcp-github',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: github',
    '    transport: stdio',
    '    command: npx',
    '    cwd: /srv/tools',
    '    env:',
    '      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN',
    "      MODE: 'test' # inline comment",
  ].join('\n');
  const r = parseYamlLight(text, 'cordis.patch.yml', 'dsh');
  const s = r.servers[0];
  assert.equal(s.cwd, '/srv/tools');
  assert.equal(s.env?.GITHUB_TOKEN, 'process.env.GITHUB_TOKEN');
  assert.equal(s.env?.MODE, 'test');
});

test('yaml-light: dsh missing serverName is an error diagnostic', () => {
  const text = [
    '- id: mcp-web',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    transport: streamable-http',
    "    url: 'http://localhost:3000/mcp'",
  ].join('\n');
  const r = parseYamlLight(text, 'cordis.patch.yml', 'dsh');
  assert.ok(r.diagnostics.some((d) => d.checkId === 'dsh.serverName-missing' && d.severity === 'error'));
  assert.equal(r.servers[0].url, 'http://localhost:3000/mcp');
});

test('yaml-light: dsh inline args array', () => {
  const text = [
    '- id: mcp-x',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: x',
    '    transport: stdio',
    '    command: node',
    '    args: ["-x", "a b"]',
  ].join('\n');
  const r = parseYamlLight(text, 'cordis.patch.yml', 'dsh');
  assert.deepEqual(r.servers[0].args, ['-x', 'a b']);
});
